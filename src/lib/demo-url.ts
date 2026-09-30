/**
 * Which addresses may be used as a template's live demo. The demo is framed on
 * the template page, so it has to be the creator's own site: not a search
 * engine, a social network, a video site, or a link shortener hiding where it
 * goes. The database enforces the same list (see the demo_url trigger), so this
 * is the friendly message, not the fence.
 */
export const BLOCKED_DEMO_HOSTS = [
  // search, portals and big platforms
  'google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'baidu.com', 'yandex.ru', 'wikipedia.org',
  'amazon.com', 'apple.com', 'microsoft.com', 'netflix.com', 'ebay.com',
  // social and video
  'facebook.com', 'fb.com', 'instagram.com', 'threads.net', 'twitter.com', 'x.com', 'tiktok.com',
  'linkedin.com', 'reddit.com', 'pinterest.com', 'snapchat.com', 'tumblr.com', 'quora.com',
  'youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'dailymotion.com',
  // chat
  'whatsapp.com', 'wa.me', 't.me', 'telegram.org', 'discord.com', 'discord.gg', 'messenger.com',
  // link shorteners
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at',
];

/** A host is blocked if it is on the list or a subdomain of one (m.facebook.com, www.google.com). */
export function isBlockedDemoHost(hostname: string) {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return BLOCKED_DEMO_HOSTS.some((b) => h === b || h.endsWith(`.${b}`))
    // Country versions of the big ones: google.co.uk, amazon.de, facebook.com.ph …
    || /(^|\.)(google|amazon|facebook|youtube|yahoo|bing)\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h);
}
