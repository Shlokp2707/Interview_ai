# interviewer/voice_analyzer.py
import re
from collections import Counter

FILLER_WORDS = {
    "um", "uh", "like", "you know", "basically", "literally",
    "actually", "so", "right", "okay", "hmm", "er", "ah",
    "kind of", "sort of", "i mean", "you see",
}

def analyze_speaking(transcript: str) -> dict:
    """
    Scores vocabulary power and speaking quality from a transcript.
    Returns a dict that gets merged into InterviewState.
    """
    if not transcript or not transcript.strip():
        return _empty_speaking_scores()

    text_lower   = transcript.lower()
    words_raw    = re.findall(r"\b[a-z']+\b", text_lower)
    sentences    = re.split(r"[.!?]+", transcript.strip())
    sentences    = [s.strip() for s in sentences if s.strip()]
    word_count   = len(words_raw)

    # ── Filler word count ──────────────────────────────────────
    filler_hits = []
    for fw in FILLER_WORDS:
        pattern = r"\b" + re.escape(fw) + r"\b"
        hits    = re.findall(pattern, text_lower)
        filler_hits.extend(hits)
    filler_count = len(filler_hits)
    filler_ratio = round(filler_count / word_count * 100, 1) if word_count else 0

    # ── Type-Token Ratio (vocabulary richness) ─────────────────    
    unique_words = set(words_raw)
    ttr          = round(len(unique_words) / word_count, 3) if word_count else 0

    # ── Avg sentence length (proxy for complexity) ─────────────
    avg_sent_len = round(word_count / len(sentences), 1) if sentences else 0

    # ── Vocabulary level (simple tier by avg word length) ──────
    avg_word_len = round(sum(len(w) for w in words_raw) / word_count, 2) if word_count else 0
    if avg_word_len >= 6.5:
        vocab_level = "Advanced"
    elif avg_word_len >= 5.2:
        vocab_level = "Intermediate"
    else:
        vocab_level = "Basic"

    # ── Fluency score (0-10) ───────────────────────────────────
    # Penalise filler ratio, reward TTR and sentence complexity
    fluency = 10.0
    fluency -= min(filler_ratio * 0.3, 3.0)   # up to -3 for fillers
    fluency += min((ttr - 0.4) * 10, 2.0)     # up to +2 for rich vocab
    fluency += min((avg_sent_len - 8) * 0.1, 1.0)  # slight bonus for longer sentences
    fluency  = max(0.0, min(10.0, round(fluency, 1)))

    return {
        "word_count":    word_count,
        "filler_count":  filler_count,
        "filler_ratio":  filler_ratio,
        "unique_words":  len(unique_words),
        "ttr":           ttr,
        "avg_sent_len":  avg_sent_len,
        "vocab_level":   vocab_level,
        "fluency_score": fluency,
        "top_fillers":   list(set(filler_hits))[:5],
    }

def _empty_speaking_scores() -> dict:
    return {
        "word_count": 0, "filler_count": 0, "filler_ratio": 0.0,
        "unique_words": 0, "ttr": 0.0, "avg_sent_len": 0.0,
        "vocab_level": "N/A", "fluency_score": 0.0, "top_fillers": [],
    }