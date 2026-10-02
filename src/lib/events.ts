/** Browser event fired after a vote so the header can show the new yowkbit balance. */
export const YOWKBITS_EVENT = 'yowkly:yowkbits';

/** Browser event with the new unread-messages count (from the inbox or the presence heartbeat). */
export const MESSAGES_EVENT = 'yowkly:messages';

/** Browser event asking the floating chat dock to open a conversation (detail = conversation id). */
export const OPEN_CHAT_EVENT = 'yowkly:open-chat';

/** Optimistic posts: the composer announces a draft, then whether it saved or failed. */
export const POST_DRAFT_EVENT = 'yowkly:post-draft';
