"""Vernacular AI order capture engine.

Pure domain parsing module:
- Must NOT import FastAPI.
- Defines OrderParser protocol.
- Provides RuleBasedParser (default and fallback) and LLMParser.
- Multilingual and vernacular parsing: Hinglish, Hindi, Devanagari digits, units, and size hints.
"""

from dataclasses import dataclass, field
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Protocol, Tuple

from dotenv import load_dotenv
import httpx
from pydantic import BaseModel, Field
from sqlmodel import select

# -----------------------------------------------------------------------------
# Provider Settings & Configuration
# -----------------------------------------------------------------------------
# Hardcoded provider settings as constants in one block at top of file
LLM_BASE_URL = "https://api.groq.com/openai/v1"
LLM_MODEL = "qwen/qwen3.8-27b"

# Read only LLM_API_KEY and CAPTURE_PARSER from root .env using python-dotenv
load_dotenv()
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
CAPTURE_PARSER = os.getenv("CAPTURE_PARSER", "rule").lower()

logger = logging.getLogger("orderease.capture")

# Path to dictionary resource
DICT_PATH = os.path.join(os.path.dirname(__file__), "capture_dictionary.json")


def load_dictionary() -> Dict[str, Any]:
    with open(DICT_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


DICTIONARY = load_dictionary()


@dataclass
class ParsedLine:
    original_words: str
    sku_code: Optional[str] = None
    qty: Optional[int] = None
    unit: str = "unknown"  # case | piece | unknown
    confidence: str = "low"  # high | medium | low
    alternatives: List[str] = field(default_factory=list)
    flags: List[str] = field(default_factory=list)  # out_of_stock | needs_unit | no_match

    def to_dict(self) -> Dict[str, Any]:
        return {
            "original_words": self.original_words,
            "sku_code": self.sku_code,
            "qty": self.qty,
            "unit": self.unit,
            "confidence": self.confidence,
            "alternatives": self.alternatives,
            "flags": self.flags,
        }


@dataclass
class CaptureResult:
    retailer_id: int
    raw_text: str
    lines: List[ParsedLine] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "retailer_id": self.retailer_id,
            "raw_text": self.raw_text,
            "lines": [l.to_dict() for l in self.lines],
        }


class OrderParser(Protocol):
    def parse(self, text: str, retailer_id: int, session: Any) -> CaptureResult:
        ...


class LLMLineItem(BaseModel):
    original_words: str
    qty: Optional[int] = None
    unit: str = "unknown"
    item_text: str = ""

    model_config = {"extra": "ignore"}


class LLMResponse(BaseModel):
    lines: List[LLMLineItem] = Field(default_factory=list)

    model_config = {"extra": "ignore"}


class RuleBasedParser:
    """Deterministic, high-performance rule-based vernacular order parser."""

    def __init__(self, data: Optional[Dict[str, Any]] = None):
        self.data = data or DICTIONARY
        self.devanagari_digits = self.data.get("devanagari_digits", {})
        self.number_words = self.data.get("number_words", {})
        self.unit_words = self.data.get("unit_words", {})
        self.categories = self.data.get("categories", {})

    def _normalize_digits(self, text: str) -> str:
        """Converts Devanagari digits to standard Arabic numerals."""
        res = []
        for ch in text:
            res.append(self.devanagari_digits.get(ch, ch))
        return "".join(res)

    def _split_into_lines(self, text: str) -> List[str]:
        """Splits message on commas, 'aur', 'and', '+', and newlines."""
        pattern = r",|\band\b|\baur\b|\+|\n"
        parts = re.split(pattern, text, flags=re.IGNORECASE)
        segments = [p.strip() for p in parts if p.strip()]
        return segments

    @staticmethod
    def _term_matches(term: str, text: str) -> bool:
        """Robust boundary match supporting Latin and Indic/Devanagari text."""
        pattern = rf"(?:^|\b|\d|[\s,.\-+!()\[\]/\\]){re.escape(term.lower())}(?:$|\b|\d|[\s,.\-+!()\[\]/\\])"
        return bool(re.search(pattern, text, flags=re.IGNORECASE))

    def _extract_quantity(self, text: str) -> Optional[int]:
        """Extracts quantity from digits or Hindi number words (ek, do, teen...)."""
        norm = self._normalize_digits(text.lower())

        # 1. Look for quantity directly adjacent to any unit word
        all_unit_words = []
        for words in self.unit_words.values():
            all_unit_words.extend(words)
        all_unit_words.sort(key=len, reverse=True)

        nw_patterns = sorted(self.number_words.keys(), key=len, reverse=True)
        num_or_word_pat = rf"(\d+|{'|'.join(re.escape(w) for w in nw_patterns)})"
        unit_pat = rf"(?:{'|'.join(re.escape(u) for u in all_unit_words)})"

        # Check: <num> <unit>
        m_before = re.search(
            rf"(?:^|[\s,.\-+!()\[\]/\\]){num_or_word_pat}\s*{unit_pat}(?:$|[\s,.\-+!()\[\]/\\])",
            norm,
            flags=re.IGNORECASE,
        )
        if m_before:
            val = m_before.group(1).lower()
            if val.isdigit():
                return int(val)
            if val in self.number_words:
                return self.number_words[val]

        # Check: <unit> <num>
        m_after = re.search(
            rf"(?:^|[\s,.\-+!()\[\]/\\]){unit_pat}\s*{num_or_word_pat}(?:$|[\s,.\-+!()\[\]/\\])",
            norm,
            flags=re.IGNORECASE,
        )
        if m_after:
            val = m_after.group(1).lower()
            if val.isdigit():
                return int(val)
            if val in self.number_words:
                return self.number_words[val]

        # 2. If no quantity adjacent to unit, mask out size hints
        size_mask_pat = (
            r"(?:^|[\s,.\-+!()\[\]/\\])\d+\s*"
            r"(?:wala|wale|wali|वाला|वाले|वाली|kilo|kg|k|gm|g|gram|ग्राम|किलो|ml|l|liter|लीटर|rupey|rs|rupee|रुपये|रु)"
            r"(?:$|[\s,.\-+!()\[\]/\\])"
        )
        cleaned_text = re.sub(size_mask_pat, " ", norm, flags=re.IGNORECASE)

        # Check standard digits
        digit_match = re.search(r"\b(\d+)\b", cleaned_text)
        if digit_match:
            try:
                return int(digit_match.group(1))
            except ValueError:
                pass

        # Check Hindi number words
        for token in re.findall(r"\w+", cleaned_text):
            if token in self.number_words:
                return self.number_words[token]

        return None

    def _extract_unit(self, text: str) -> str:
        """Extracts unit: case (peti/carton), piece (packet/pcs), or unknown."""
        norm = self._normalize_digits(text.lower())

        # Check case words
        case_candidates = self.unit_words.get("case", [])
        for word in case_candidates:
            if self._term_matches(word, norm):
                return "case"

        # Check piece words
        piece_candidates = self.unit_words.get("piece", [])
        for word in piece_candidates:
            if self._term_matches(word, norm):
                return "piece"

        return "unknown"

    def _clean_for_alias_match(self, text: str) -> str:
        """Strips conversational noise words to normalize alias lookups."""
        noise = ["bhaiya", "bhai", "ji", "kripya", "please", "sir", "namaste", "chahiye", "bhejo", "bhej do"]
        cleaned = text.lower()
        for n in noise:
            cleaned = re.sub(rf"\b{re.escape(n)}\b", "", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned

    def get_sku_category(self, sku_code: Optional[str]) -> Optional[str]:
        """Returns the product category name for a given SKU code, or None."""
        if not sku_code:
            return None
        for cat_name, cat_data in self.categories.items():
            if sku_code in cat_data.get("skus", {}):
                return cat_name
        return None

    def get_text_category(self, text: str) -> Optional[str]:
        """Infers category from keywords in the text (longest keyword match)."""
        if not text:
            return None
        norm = self._normalize_digits(text.lower())
        best_cat: Optional[str] = None
        matched_kw_len = 0
        for cat_name, cat_data in self.categories.items():
            for kw in cat_data.get("keywords", []):
                if self._term_matches(kw, norm):
                    if len(kw) > matched_kw_len:
                        matched_kw_len = len(kw)
                        best_cat = cat_name
        return best_cat

    def is_category_compatible(self, text: str, sku_code: Optional[str]) -> bool:
        """Enforces that a matched SKU never has a different product category than the item words.
        Detergent words can never match tea, biscuit words can never match detergent, etc.
        """
        if not sku_code or not text:
            return True
        sku_cat = self.get_sku_category(sku_code)
        if not sku_cat:
            return True
        text_cat = self.get_text_category(text)
        if not text_cat:
            return True
        return text_cat == sku_cat

    def match_item(
        self,
        item_text: str,
        original_words: str,
        alias_map: Dict[str, str],
        past_sku_counts: Dict[str, int],
        all_skus: Dict[str, Any],
    ) -> Tuple[Optional[str], str, List[str], List[str]]:
        """Matches an item through aliases, keywords, and past order history.

        Returns:
            (sku_code, confidence, alternatives, flags)
        """
        norm_words = self._normalize_digits(original_words.lower())
        clean_words = self._clean_for_alias_match(norm_words)

        norm_item = self._normalize_digits(item_text.lower())
        clean_item = self._clean_for_alias_match(norm_item)

        matched_sku: Optional[str] = None
        confidence = "low"
        alternatives: List[str] = []
        flags: List[str] = []

        # -----------------------------------------------------------------
        # Step (a): Retailer's Alias exact match -> High Confidence
        # Only valid if category compatible (detergent words can never match tea)
        # -----------------------------------------------------------------
        def _valid_alias(cand_sku: Optional[str]) -> bool:
            if not cand_sku:
                return False
            if not self.is_category_compatible(original_words, cand_sku):
                return False
            if not self.is_category_compatible(item_text, cand_sku):
                return False
            return True

        for cand in [norm_words, clean_words, norm_item, clean_item]:
            if cand in alias_map and _valid_alias(alias_map[cand]):
                matched_sku = alias_map[cand]
                confidence = "high"
                break

        if not matched_sku:
            clean_alias_map = {self._clean_for_alias_match(k): v for k, v in alias_map.items()}
            for cand in [norm_words, clean_words, norm_item, clean_item]:
                if cand in clean_alias_map and _valid_alias(clean_alias_map[cand]):
                    matched_sku = clean_alias_map[cand]
                    confidence = "high"
                    break

        if not matched_sku:
            for alias_words, alias_sku in alias_map.items():
                if not _valid_alias(alias_sku):
                    continue
                clean_alias = self._clean_for_alias_match(alias_words)
                if alias_words and (
                    alias_words in norm_words
                    or alias_words in clean_words
                    or alias_words in norm_item
                    or alias_words in clean_item
                ):
                    matched_sku = alias_sku
                    confidence = "high"
                    break
                if clean_alias and (
                    clean_alias in norm_words
                    or clean_alias in clean_words
                    or (clean_words and clean_words in clean_alias)
                ):
                    matched_sku = alias_sku
                    confidence = "high"
                    break

        # -----------------------------------------------------------------
        # Step (b) & (c): Keyword match from dictionary + competing SKUs
        # -----------------------------------------------------------------
        if not matched_sku:
            best_cat = None
            matched_keyword_len = 0

            # Match longest category keyword against item_text and original words
            for cat_name, cat_data in self.categories.items():
                for kw in cat_data.get("keywords", []):
                    if self._term_matches(kw, norm_item) or self._term_matches(kw, norm_words):
                        if len(kw) > matched_keyword_len:
                            matched_keyword_len = len(kw)
                            best_cat = (cat_name, cat_data)

            if best_cat:
                cat_name, cat_data = best_cat
                skus_dict = cat_data.get("skus", {})

                # Check size hints
                best_sku_code = None
                for sku_code, sku_info in skus_dict.items():
                    for hint in sku_info.get("hints", []):
                        if self._term_matches(hint, norm_item) or self._term_matches(hint, norm_words):
                            best_sku_code = sku_code
                            break
                    if best_sku_code:
                        break

                # If no size hint, boost by past orders
                if not best_sku_code:
                    cat_skus = list(skus_dict.keys())
                    boosted_sku = max(
                        cat_skus,
                        key=lambda c: past_sku_counts.get(c, 0),
                        default=None,
                    )
                    if boosted_sku and past_sku_counts.get(boosted_sku, 0) > 0:
                        best_sku_code = boosted_sku
                    else:
                        best_sku_code = cat_data.get("default_sku")

                matched_sku = best_sku_code
                # Competing similar SKUs in same category -> medium confidence with alternatives
                competing = [sc for sc in skus_dict.keys() if sc != matched_sku]
                alternatives = competing[:2]
                confidence = "medium" if competing else "high"

        # -----------------------------------------------------------------
        # Post-match safeguard: Category compatibility
        # A matched SKU must never have a different product category than the item words
        # -----------------------------------------------------------------
        if matched_sku:
            if not self.is_category_compatible(original_words, matched_sku) or not self.is_category_compatible(item_text, matched_sku):
                matched_sku = None
                confidence = "low"
                alternatives = []
                if "no_match" not in flags:
                    flags.append("no_match")

        # -----------------------------------------------------------------
        # Step (d): No Match -> Low Confidence, no SKU
        # -----------------------------------------------------------------
        if not matched_sku:
            confidence = "low"
            if "no_match" not in flags:
                flags.append("no_match")
        else:
            # Check out of stock flag
            sku_obj = all_skus.get(matched_sku)
            if sku_obj and sku_obj.stock_cases <= 0:
                flags.append("out_of_stock")

        return matched_sku, confidence, alternatives, flags

    def parse(self, text: str, retailer_id: int, session: Any) -> CaptureResult:
        from backend.app.models import Alias, SKU, Order, OrderLine

        segments = self._split_into_lines(text)
        parsed_lines: List[ParsedLine] = []

        # Pre-fetch all Aliases for this retailer
        aliases = session.exec(
            select(Alias).where(Alias.retailer_id == retailer_id)
        ).all()
        alias_map = {a.original_words.strip().lower(): a.sku_code for a in aliases}

        # Pre-fetch retailer past order SKUs to boost matching
        past_sku_counts: Dict[str, int] = {}
        try:
            past_orders = session.exec(
                select(Order).where(Order.retailer_id == retailer_id)
            ).all()
            for po in past_orders:
                lines = session.exec(
                    select(OrderLine).where(OrderLine.order_id == po.id)
                ).all()
                for ol in lines:
                    past_sku_counts[ol.sku_code] = past_sku_counts.get(ol.sku_code, 0) + ol.qty_cases
        except Exception:
            pass

        # Pre-fetch all SKUs for stock checking
        all_skus = {s.code: s for s in session.exec(select(SKU)).all()}

        for segment in segments:
            qty = self._extract_quantity(segment)
            unit = self._extract_unit(segment)

            matched_sku, confidence, alternatives, flags = self.match_item(
                item_text=segment,
                original_words=segment,
                alias_map=alias_map,
                past_sku_counts=past_sku_counts,
                all_skus=all_skus,
            )

            if unit == "unknown" and "needs_unit" not in flags:
                flags.append("needs_unit")

            parsed_lines.append(
                ParsedLine(
                    original_words=segment,
                    sku_code=matched_sku,
                    qty=qty,
                    unit=unit,
                    confidence=confidence,
                    alternatives=alternatives,
                    flags=flags,
                )
            )

        return CaptureResult(
            retailer_id=retailer_id,
            raw_text=text,
            lines=parsed_lines,
        )


class LLMParser:
    """LLM-based order parser using httpx against an OpenAI-compatible /chat/completions endpoint."""

    def __init__(
        self,
        base_url: str = LLM_BASE_URL,
        model: str = LLM_MODEL,
        api_key: Optional[str] = None,
        timeout: float = 10.0,
    ):
        self.base_url = base_url
        self.model = model
        self.api_key = api_key if api_key is not None else os.getenv("LLM_API_KEY", LLM_API_KEY)
        self.timeout = timeout
        self.fallback = RuleBasedParser()

    def _validate_unit(self, unit: str, original_words: str) -> str:
        """If the LLM returns a unit that does not appear in the original words, set to unknown."""
        if unit not in ("case", "piece"):
            return "unknown"
        candidates = self.fallback.unit_words.get(unit, [])
        all_candidates = set(candidates) | {unit}
        norm = original_words.lower()
        for cand in all_candidates:
            if RuleBasedParser._term_matches(cand, norm):
                return unit
        return "unknown"

    def _shares_keyword_or_alias(
        self,
        item_text: str,
        sku_code: Optional[str],
        alias_map: Dict[str, str],
        all_skus: Dict[str, Any],
    ) -> bool:
        """Checks if the LLM's item_text and the matched SKU share any keyword, size hint, or alias."""
        if not sku_code or not item_text:
            return False

        norm_item = self.fallback._normalize_digits(item_text.lower())
        clean_item = self.fallback._clean_for_alias_match(norm_item)

        # 1. Check if item_text matches an alias for sku_code
        for alias_words, alias_sku in alias_map.items():
            if alias_sku == sku_code:
                clean_alias = self.fallback._clean_for_alias_match(alias_words)
                if (
                    clean_item == clean_alias
                    or clean_alias in clean_item
                    or clean_item in clean_alias
                    or self.fallback._term_matches(clean_alias, norm_item)
                ):
                    return True

        # 2. Check if item_text matches keywords or size hints for sku_code's category
        sku_cat = self.fallback.get_sku_category(sku_code)
        if sku_cat and sku_cat in self.fallback.categories:
            cat_data = self.fallback.categories[sku_cat]
            for kw in cat_data.get("keywords", []):
                if self.fallback._term_matches(kw, norm_item):
                    return True
            sku_info = cat_data.get("skus", {}).get(sku_code, {})
            for hint in sku_info.get("hints", []):
                if self.fallback._term_matches(hint, norm_item):
                    return True

        # 3. Check if any distinctive word from SKU name matches item_text
        sku_obj = all_skus.get(sku_code)
        if sku_obj and sku_obj.name:
            for word in re.findall(r"\w+", sku_obj.name.lower()):
                if len(word) > 2 and word not in ("case", "piece", "packet", "pack", "box"):
                    if self.fallback._term_matches(word, norm_item):
                        return True

        return False

    def parse(self, text: str, retailer_id: int, session: Any) -> CaptureResult:
        try:
            return self._parse_with_llm(text, retailer_id, session)
        except Exception as exc:
            logger.warning("LLM parsing failed: %s; falling back to RuleBasedParser", exc)
            return self.fallback.parse(text, retailer_id, session)

    def _parse_with_llm(self, text: str, retailer_id: int, session: Any) -> CaptureResult:
        from backend.app.models import SKU, Alias, Order, OrderLine

        all_skus = {s.code: s for s in session.exec(select(SKU)).all()}
        catalog_lines = "\n".join(f"- {s.code}: {s.name}" for s in all_skus.values())

        system_prompt = (
            "You are an FMCG wholesale order capture assistant for Indian kirana stores.\n"
            "Given a customer's order message and a product catalog, extract the ordered items into a JSON object.\n"
            "Output JSON with this exact structure:\n"
            '{"lines": [{"original_words": "<exact line segment>", "qty": <int or null>, '
            '"unit": "<case|piece|unknown>", "item_text": "<item description without quantity/unit>"}]}\n'
            "Rules:\n"
            "1. Output ONLY valid JSON, with no explanation or surrounding prose.\n"
            "2. Temperature is 0.\n"
            "3. unit must be strictly 'case', 'piece', or 'unknown'. If no unit word appears in original_words, use 'unknown'.\n"
            "4. NEVER invent or output any sku or sku_code field."
        )

        user_content = f"Catalog:\n{catalog_lines}\n\nOrder message:\n{text}"

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "temperature": 0,
        }

        url = f"{self.base_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(url, json=payload, headers=headers)
            if response.status_code == 429 or response.status_code >= 500:
                raise httpx.HTTPStatusError(
                    f"HTTP {response.status_code}",
                    request=response.request,
                    response=response,
                )
            response.raise_for_status()
            resp_data = response.json()

        raw_content = resp_data["choices"][0]["message"]["content"]
        if not raw_content or not raw_content.strip():
            raise ValueError("LLM returned empty content")

        # Strip any <think>...</think> block before parsing
        cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw_content, flags=re.DOTALL).strip()

        # Extract JSON even when wrapped in code fences
        fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
        if fence_match:
            cleaned = fence_match.group(1).strip()
        else:
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start != -1 and end != -1 and end > start:
                cleaned = cleaned[start : end + 1]

        if not cleaned:
            raise ValueError("No JSON block found in LLM output")

        parsed_json = json.loads(cleaned)
        llm_response = LLMResponse.model_validate(parsed_json)
        if not llm_response.lines:
            raise ValueError("LLM response contains no lines")

        # Pre-fetch aliases for this retailer
        aliases = session.exec(
            select(Alias).where(Alias.retailer_id == retailer_id)
        ).all()
        alias_map = {a.original_words.strip().lower(): a.sku_code for a in aliases}

        # Pre-fetch past order counts
        past_sku_counts: Dict[str, int] = {}
        try:
            past_orders = session.exec(
                select(Order).where(Order.retailer_id == retailer_id)
            ).all()
            for po in past_orders:
                lines = session.exec(
                    select(OrderLine).where(OrderLine.order_id == po.id)
                ).all()
                for ol in lines:
                    past_sku_counts[ol.sku_code] = past_sku_counts.get(ol.sku_code, 0) + ol.qty_cases
        except Exception:
            pass

        parsed_lines: List[ParsedLine] = []
        for line in llm_response.lines:
            orig = line.original_words
            item_text = line.item_text or orig

            # Validate unit against original words
            unit = self._validate_unit(line.unit, orig)

            # Validate quantity
            qty = line.qty
            if qty is None:
                qty = self.fallback._extract_quantity(orig)

            # Match item through aliases, keywords, and history (ignoring any LLM sku)
            matched_sku, confidence, alternatives, flags = self.fallback.match_item(
                item_text=item_text,
                original_words=orig,
                alias_map=alias_map,
                past_sku_counts=past_sku_counts,
                all_skus=all_skus,
            )

            # Guard: if the LLM's item_text and matched SKU share no keyword or alias,
            # downgrade the line to Low and list alternatives
            if matched_sku and not self._shares_keyword_or_alias(item_text, matched_sku, alias_map, all_skus):
                confidence = "low"
                if not alternatives:
                    competing = [sc for sc in all_skus.keys() if sc != matched_sku]
                    alternatives = competing[:2]

            if unit == "unknown" and "needs_unit" not in flags:
                flags.append("needs_unit")

            parsed_lines.append(
                ParsedLine(
                    original_words=orig,
                    sku_code=matched_sku,
                    qty=qty,
                    unit=unit,
                    confidence=confidence,
                    alternatives=alternatives,
                    flags=flags,
                )
            )

        return CaptureResult(
            retailer_id=retailer_id,
            raw_text=text,
            lines=parsed_lines,
        )


def get_parser() -> OrderParser:
    """Factory selecting OrderParser based on CAPTURE_PARSER env var (rule | llm | auto)."""
    mode = os.getenv("CAPTURE_PARSER", os.getenv("ORDER_PARSER_MODE", "rule")).lower()
    if mode in ("llm", "auto"):
        return LLMParser()
    return RuleBasedParser()
