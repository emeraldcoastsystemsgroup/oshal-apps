# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Deterministic recorded-term fidelity pass restoring 6+-letter words miswritten by the model when a unique recorded term within edit distance 1-2 shares first letter, length within 1, and recorded neighbor context.
"""Deterministic restoration of recorded profile terms miswritten during generation."""
from __future__ import annotations

import copy
import re

_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'-]+")
_STOP_WORDS = frozenset({
    "the", "and", "for", "with", "from", "into", "that", "this", "are", "was", "were",
    "has", "have", "had", "our", "their", "its", "his", "her", "all", "any", "per", "via",
    "not", "but", "can", "will", "may", "who", "whom", "whose", "which", "what", "when",
    "where", "while", "how", "why", "than", "then", "them", "they", "these", "those",
    "some", "such", "each", "both", "more", "most", "other", "over", "under", "after",
    "before", "between", "through", "during", "without", "within", "across", "among",
    "against", "around", "about", "upon", "onto", "out", "off", "only", "also", "very",
    "just", "being", "been", "did", "does", "done", "your", "yours", "ours", "theirs",
})


def _iter_strings(node, out: list) -> list:
    """@description Collect all string values recursively from nested dicts, lists, and tuples.
    @param node - Arbitrary data structure. @param out - Accumulator list. @returns Accumulator list."""
    if isinstance(node, str):
        if node:
            out.append(node)
    elif isinstance(node, dict):
        for val in node.values():
            _iter_strings(val, out)
    elif isinstance(node, (list, tuple, set)):
        for item in node:
            _iter_strings(item, out)
    return out


def _collect_records(prof, selected) -> tuple[set, dict]:
    """@description Collect all lower-cased recorded words and neighbor sets for recorded words of 6+ letters.
    @param prof - Candidate profile dict. @param selected - Selected additional experience entries.
    @returns Tuple of (all_recorded_words_set, {word_6plus: set_of_adjacent_words})."""
    words_set: set = set()
    neighbors: dict[str, set] = {}
    for text in _iter_strings([prof, selected], []):
        tokens = [m.group(0).lower() for m in _WORD_RE.finditer(text)]
        words_set.update(tokens)
        qual = [tok for tok in tokens if len(tok) >= 3 and tok not in _STOP_WORDS]
        for idx, tok in enumerate(qual):
            if len(tok) >= 6:
                adj = neighbors.setdefault(tok, set())
                if idx > 0:
                    adj.add(qual[idx - 1])
                if idx + 1 < len(qual):
                    adj.add(qual[idx + 1])
    return words_set, neighbors


def _collect_posting(posting) -> set:
    """@description Collect all lower-cased words from a posting's title and description.
    @param posting - Posting dict or None. @returns Set of lower-cased words."""
    if not posting:
        return set()
    texts = []
    if isinstance(posting, dict):
        _iter_strings([posting.get("title"), posting.get("description")], texts)
    else:
        _iter_strings(posting, texts)
    return {m.group(0).lower() for text in texts for m in _WORD_RE.finditer(text)}


def _levenshtein_bounded(a: str, b: str, limit: int = 2) -> int:
    """@description Hand-implemented bounded Levenshtein distance between two strings.
    @param a - First word. @param b - Second word. @param limit - Distance bound (default 2).
    @returns Edit distance if <= limit, else limit + 1."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i] + [0] * len(b)
        row_min = i
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            val = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
            curr[j] = val
            if val < row_min:
                row_min = val
        if row_min > limit:
            return limit + 1
        prev = curr
    return prev[-1]


def _same_stem(a: str, b: str) -> bool:
    """@description Whether two words differ only in their ending ("managed" and "manages", "enclave" and
    "enclaves"): another form of the same word, not a miswriting of it.
    @param a - One word. @param b - The other. @returns True when the difference is confined to the last letters."""
    common = 0
    for ca, cb in zip(a, b):
        if ca != cb:
            break
        common += 1
    return common >= min(len(a), len(b)) - 2


def _apply_case(source: str, target: str) -> str:
    """@description Apply source word's capitalisation pattern (ALL CAPS, Capitalised, or lower) to target.
    @param source - Original output token. @param target - Lower-cased replacement token.
    @returns Cased replacement token."""
    if source.isupper():
        return target.upper()
    if source[0].isupper():
        return target[0].upper() + target[1:]
    return target


def _restore_text(text: str, path: str, known: set, neighbors: dict, changes: list) -> str:
    """@description Restore miswritten 6+-letter terms in one string when a unique recorded neighbor-verified match exists.
    @param text - Output string. @param path - Dotted path. @param known - Union of recorded and posting words.
    @param neighbors - Map of 6+-letter recorded words to adjacent words. @param changes - Output change list.
    @returns Updated string."""
    matches = list(_WORD_RE.finditer(text))
    if not matches:
        return text
    qual_indices = [idx for idx, m in enumerate(matches)
                    if len(m.group(0)) >= 3 and m.group(0).lower() not in _STOP_WORDS]
    pos_in_qual = {m_idx: q_pos for q_pos, m_idx in enumerate(qual_indices)}
    out, last = [], 0
    for idx, match in enumerate(matches):
        raw = match.group(0)
        low = raw.lower()
        if len(low) < 6 or low in known:
            continue
        q_pos = pos_in_qual.get(idx)
        if q_pos is None:
            continue
        w_adj = set()
        if q_pos > 0:
            w_adj.add(matches[qual_indices[q_pos - 1]].group(0).lower())
        if q_pos + 1 < len(qual_indices):
            w_adj.add(matches[qual_indices[q_pos + 1]].group(0).lower())
        if not w_adj:
            continue
        candidates = [
            rec_word for rec_word in neighbors
            if rec_word[0] == low[0]
            and abs(len(rec_word) - len(low)) <= 1
            and 1 <= _levenshtein_bounded(low, rec_word, 2) <= 2
            and not _same_stem(low, rec_word)
        ]
        if len(candidates) != 1 or not (w_adj & neighbors[candidates[0]]):
            continue
        repl = _apply_case(raw, candidates[0])
        out.append(text[last:match.start()])
        out.append(repl)
        last = match.end()
        changes.append({"path": path, "from": raw, "to": repl})
    if not last:
        return text
    out.append(text[last:])
    return "".join(out)


def _walk_restore(node, path: str, known: set, neighbors: dict, changes: list):
    """@description Recursively visit strings inside dicts and lists to restore miswritten recorded terms.
    @param node - Current JSON node. @param path - Dotted path. @param known - Recorded + posting words.
    @param neighbors - Recorded 6+-letter neighbor map. @param changes - Output change list. @returns Updated node."""
    if isinstance(node, str):
        return _restore_text(node, path, known, neighbors, changes)
    if isinstance(node, list):
        return [_walk_restore(item, f"{path}.{idx}", known, neighbors, changes) for idx, item in enumerate(node)]
    if isinstance(node, dict):
        return {k: _walk_restore(v, f"{path}.{k}", known, neighbors, changes) for k, v in node.items()}
    return node


def restore(data: dict, prof: dict, selected=(), posting=None) -> tuple[dict, list]:
    """@description Restore 6+-letter words miswritten by the model to recorded terms with matching neighbor context.
    @param data - Generated packet dict. @param prof - Candidate profile dict.
    @param selected - Optional selected additional experience. @param posting - Optional target posting dict.
    @returns Tuple of (updated packet dict, list of change dicts)."""
    if not isinstance(data, dict):
        return data, []
    rec_words, neighbors = _collect_records(prof, selected)
    if not neighbors:
        return data, []
    known = rec_words | _collect_posting(posting)
    new_data = copy.deepcopy(data)
    changes: list = []
    for section in ("resume", "cover"):
        if section in new_data:
            new_data[section] = _walk_restore(new_data[section], section, known, neighbors, changes)
    return (new_data, changes) if changes else (data, [])
