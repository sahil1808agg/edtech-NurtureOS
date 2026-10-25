import { redirect } from 'next/navigation';

/** Chat lives in each child's workspace now; home picks (or skips straight to) the child. */
export default function LegacyChatEntry() {
  redirect('/');
}
