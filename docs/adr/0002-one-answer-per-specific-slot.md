---
status: superseded by ADR-0008
---

# One answer per specific slot

Superseded by ADR 0008. A slot can now hold a default answer and further answers, one per situation. Personal email and work email are still different slots.

A slot holds at most one answer. Personal email and work email are different slots, not two answers on one email slot. When a field asks for a slot the profile does not have, the fill asks the user instead of writing a nearby answer. Multi-value slots were rejected, as was writing whichever answer of that kind was stored first, because a silent wrong fill is worse than one question.
