# 04 — A situation keeps its own answer

**What to build:** A slot can hold a default answer and one answer per situation. The situation name comes from the heading, or from the person. A new situation is never written on confidence alone.

**Blocked by:** 02 — A fill writes one form

**Status:** ready-for-agent

- [ ] A confident match to an existing situation writes that answer and stores the heading as an alias of the situation.
- [ ] A confident default writes the default answer, stores the field wording as a slot alias, and does not store the heading as a situation.
- [ ] A special heading stores a situation and leaves the default empty.
- [ ] A new-situation choice at or above 0.85 still opens a check. The heading text is the proposed name. The person can accept or edit it.
- [ ] An answer typed for that new situation is stored only on the situation.
- [ ] "This is my usual answer" saves the default when the slot has none, and stores no situation.
- [ ] Once a default exists, "this is my usual answer" writes the stored string and does not replace it.
- [ ] A heading with no text proposes no situation name.
- [ ] Each field uses its own heading, including two headings inside one form tag.
- [ ] Personal email and work email stay different slots.
