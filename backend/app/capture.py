"""Vernacular AI order capture engine.

Pure domain parsing module:
- Must NOT import FastAPI.
- Defines OrderParser protocol.
- Provides RuleBasedParser (default) and stub LLMParser (selected via ORDER_PARSER_MODE=llm).
- Multilingual and vernacular parsing: Hinglish, Hindi, Devanagari digits, units, and size hints.
"""

from dataclasses import dataclass, field
import json
import os
import re
from typing import Any, Dict, List, Optional, Protocol, Tuple
from sqlmodel import select

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


class LLMParser:
    """Stub LLM parser for future advanced generative parsing."""

    def parse(self, text: str, retailer_id: int, session: Any) -> CaptureResult:
        raise NotImplementedError(
            "LLMParser is not implemented yet. Set ORDER_PARSER_MODE=rule to use RuleBasedParser."
        )


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
        # Split pattern matches commas, newlines, +, and words 'aur' / 'and'
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
        # (e.g. '5 peti', '1 peti', '५ पेटी', 'do peti', or 'peti 5')
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

        # 2. If no quantity adjacent to unit, mask out size hints so they aren't mistaken for quantities
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
            norm_seg = self._normalize_digits(segment.lower())
            clean_seg = self._clean_for_alias_match(norm_seg)

            matched_sku: Optional[str] = None
            confidence = "low"
            alternatives: List[str] = []
            flags: List[str] = []

            # -----------------------------------------------------------------
            # Step (a): Retailer's Alias exact match -> High Confidence
            # -----------------------------------------------------------------
            # Check direct match on segment or stripped clean_seg
            if norm_seg in alias_map:
                matched_sku = alias_map[norm_seg]
                confidence = "high"
            elif clean_seg in alias_map:
                matched_sku = alias_map[clean_seg]
                confidence = "high"
            else:
                # Check substring match for alias if alias is a substantial phrase
                for alias_words, alias_sku in alias_map.items():
                    if alias_words and (alias_words in norm_seg or alias_words in clean_seg):
                        matched_sku = alias_sku
                        confidence = "high"
                        break

            # -----------------------------------------------------------------
            # Step (b) & (c): Keyword match from dictionary + competing SKUs
            # -----------------------------------------------------------------
            if not matched_sku:
                best_cat = None
                matched_keyword_len = 0

                # Match longest category keyword
                for cat_name, cat_data in self.categories.items():
                    for kw in cat_data.get("keywords", []):
                        if self._term_matches(kw, norm_seg):
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
                            if self._term_matches(hint, norm_seg):
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
            # Step (d): No Match -> Low Confidence, no SKU
            # -----------------------------------------------------------------
            if not matched_sku:
                confidence = "low"
                flags.append("no_match")
            else:
                # Check out of stock flag
                sku_obj = all_skus.get(matched_sku)
                if sku_obj and sku_obj.stock_cases <= 0:
                    flags.append("out_of_stock")

            if unit == "unknown":
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


def get_parser() -> OrderParser:
    """Factory selecting OrderParser based on ORDER_PARSER_MODE env var."""
    mode = os.getenv("ORDER_PARSER_MODE", "rule").lower()
    if mode == "llm":
        return LLMParser()
    return RuleBasedParser()

