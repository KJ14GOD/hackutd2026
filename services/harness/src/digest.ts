// Slack Block Kit for one digest: every open question for one person about one program, in one message
// (REQUIREMENTS_ANALYSIS §6.5: no flooding). Pure functions, so they're testable without Slack.

export interface DigestQuestion { id: string; program: string; text: string; options: string[]; evidence: string[]; why: string; quotes: { title: string; url: string }[] }
export interface Recipient { name: string; title: string }

/** Slack caps a button value at 2000 characters; ours carry only the ids. */
export const answerValue = (questionId: string, option: string, personId: string) => JSON.stringify({ q: questionId, o: option, p: personId });

export function digestBlocks(to: Recipient, program: string, questions: DigestQuestion[], personId: string): object[] {
  const blocks: object[] = [
    { type: 'header', text: { type: 'plain_text', text: `${questions.length} question${questions.length === 1 ? '' : 's'} about ${program}`, emoji: false } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `For *${to.name}*${to.title ? ` (${to.title})` : ''}. Theseus is rewriting ${program} and needs these decided; nothing in Jira, Notion or Slack settles them.` }] },
  ];
  for (const q of questions) {
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${q.id}*  ${q.text}` } });
    const context = [`Cited: ${q.evidence.slice(0, 3).map((e) => `\`${e.split('/').pop()}\``).join(', ') || 'none'}`, `Why you: ${q.why}`];
    if (q.quotes.length) context.push(`Already on record: ${q.quotes.slice(0, 2).map((x) => (x.url ? `<${x.url}|${x.title.slice(0, 40)}>` : x.title.slice(0, 40))).join(' · ')}`);
    blocks.push({ type: 'context', elements: context.map((text) => ({ type: 'mrkdwn', text: text.slice(0, 2900) })) });
    blocks.push({
      type: 'actions', block_id: `q:${q.id}`,
      elements: (q.options.length ? q.options : ['Keep old behavior', 'Change it']).slice(0, 4).map((o, i) => ({
        type: 'button', action_id: `answer_${i}`, text: { type: 'plain_text', text: o.slice(0, 75) }, value: answerValue(q.id, o, personId), ...(i === 0 ? { style: 'primary' } : {}),
      })),
    });
  }
  return blocks;
}

/** Replaces one question's buttons with who answered what, keeping the rest of the digest clickable. */
export function markAnswered(blocks: { type: string; block_id?: string }[], questionId: string, answer: string, by: string): object[] {
  return blocks.map((b) => (b.type === 'actions' && b.block_id === `q:${questionId}`
    ? { type: 'context', elements: [{ type: 'mrkdwn', text: `Answered *${answer}* by ${by}. Saved; the rewrite of this program continues.` }] }
    : b));
}
