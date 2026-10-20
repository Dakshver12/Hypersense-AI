# Generated interview question quality fix

This patch is based on backend/services/questions.py fetched from public main on 20 October 2026. It applies to single-question and session-batch generation.

## Behavior

- Strengthens the generation instructions: final, self-contained questions only; no brainstorming, answers, hints, drafting labels or incomplete scenarios.
- Removes a single presentation label such as `*Idea 2 (String split):*` when the rest is a usable question.
- Rejects obvious unfinished output: dangling clauses such as “CSV file where”, trailing ellipses/colons, unclosed code fences, internal reasoning/answer sections and invalid lengths.
- Allows one additional generation call to repair malformed question text. If that also fails, it returns a clear error instead of showing the draft. Valid responses still use one call.
- Provider quota/network errors and malformed JSON/count/category/duplicate batches keep their existing error handling; they do not receive this extra text-repair call.
- Duplicate detection runs after label cleanup. The selected category order, language and role/resume constraints are preserved.
- Larger batches get a proportional output-token allowance to reduce truncation pressure.

These checks catch obvious presentation and truncation problems. They are not a full grammar or semantic-quality judge. Provider wording and factual quality still need review.

## Apply and deploy

Extract into your project folder and replace the included file. Run in the activated project Python environment:

```bash
python -m unittest tests.test_question_quality tests.test_question_batch tests.test_practice_plan -v
git add backend/services/questions.py tests/test_question_quality.py QUESTION_QUALITY_FIX.md
git commit -m "Validate generated interview questions and reject drafting text"
git push origin main
```

Wait for the new Vercel Production deployment to show Ready. Start a **new interview session** to test. Existing saved reports and already-generated session queues are not rewritten by this patch. No credentials or callback changes are needed.

Sixteen targeted tests passed locally with provider responses mocked. They cover the reported CSV fragment, label cleanup, bounded repair, quota handling, duplicates, Hindi/Hinglish/code questions and session category ordering. No live AI generation was performed.
