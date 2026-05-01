"""Parse scene references like ``"1-2"`` or ``"全剧第1集第1场"`` into ``(episode, scene)``.

Used by both the bridge writer (``annotations_hl.attach_beats_to_scenes``)
and the boundary endpoint, which previously each carried a near-identical
copy of this regex + parser.
"""

from __future__ import annotations

import re

CHINESE_SCENE_RE = re.compile(r"第(\d+)集第(\d+)场")


def parse_scene_ref(ref: str | None) -> tuple[int, int] | None:
    """Parse "episode-scene" into ``(int, int)``; return ``None`` on junk.

    Accepts "1-2" format and Chinese format like "全剧第1集第1场".
    """
    if not ref:
        return None
    ref = ref.strip()
    parts = ref.split("-")
    if len(parts) == 2:
        try:
            ep, sc = int(parts[0]), int(parts[1])
            if ep >= 0 and sc >= 0:
                return ep, sc
        except ValueError:
            pass
    m = CHINESE_SCENE_RE.search(ref)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None
