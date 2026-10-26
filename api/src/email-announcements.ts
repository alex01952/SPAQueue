import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { FilterXSS, safeAttrValue } from 'xss';
import { convert } from 'html-to-text';

export interface AnnouncementAudience {
  mode: 'all' | 'club' | 'users';
  clubId?: string;
  memberIds?: string[];
}

export interface AnnouncementRecipient {
  memberId: string;
  name: string;
  email: string;
}

export interface AnnouncementInput {
  subject: string;
  html: string;
  audience: AnnouncementAudience;
}

export interface AnnouncementPreview {
  subject: string;
  html: string;
  text: string;
  recipientCount: number;
  fingerprint: string;
}

export interface AnnouncementStatus {
  requestId: string;
  status: 'sending' | 'completed';
  total: number;
  accepted: number;
  unconfirmed: number;
}

const sanitizer = new FilterXSS({
  whiteList: {
    p: [],
    br: [],
    strong: [],
    b: [],
    em: [],
    i: [],
    u: [],
    s: [],
    h1: [],
    h2: [],
    h3: [],
    ul: [],
    ol: [],
    li: [],
    blockquote: [],
    a: ['href', 'title'],
    table: [],
    thead: [],
    tbody: [],
    tr: [],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    hr: [],
    div: [],
    span: [],
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style', 'noscript', 'textarea'],
  css: false,
  safeAttrValue: (tag, name, value, cssFilter) => {
    if (name === 'href' && !/^(https?:\/\/|mailto:)/i.test(value.trim()))
      return '';
    return safeAttrValue(tag, name, value, cssFilter);
  },
});

export function validateAnnouncement(
  body: unknown,
): AnnouncementInput & { text: string } {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Announcement content is required.');
  }
  const input = body as Record<string, unknown>;
  if (
    typeof input.subject !== 'string' ||
    !input.subject.trim() ||
    input.subject.trim().length > 200 ||
    /[\r\n]/.test(input.subject)
  ) {
    throw new BadRequestException(
      'Enter a subject of 1 to 200 characters without line breaks.',
    );
  }
  if (
    typeof input.html !== 'string' ||
    Buffer.byteLength(input.html, 'utf8') > 60_000
  ) {
    throw new BadRequestException(
      'Email HTML must be at most 60,000 UTF-8 bytes.',
    );
  }
  if (!input.audience || typeof input.audience !== 'object') {
    throw new BadRequestException('Select an announcement audience.');
  }
  const audience = input.audience as Record<string, unknown>;
  if (!['all', 'club', 'users'].includes(String(audience.mode))) {
    throw new BadRequestException(
      'Select all members, a club, or specific users.',
    );
  }
  if (
    audience.mode === 'club' &&
    (typeof audience.clubId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(audience.clubId))
  ) {
    throw new BadRequestException('Select a valid club.');
  }
  if (
    audience.mode === 'users' &&
    (!Array.isArray(audience.memberIds) ||
      !audience.memberIds.length ||
      !audience.memberIds.every(
        (id: unknown) =>
          typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id),
      ))
  ) {
    throw new BadRequestException('Select at least one valid member.');
  }
  const html = sanitizer.process(input.html);
  const text = convert(html, { wordwrap: 100 });
  if (!text.trim())
    throw new BadRequestException('Enter a message with visible text.');
  return {
    subject: input.subject.trim(),
    html,
    text,
    audience: {
      mode: audience.mode as AnnouncementAudience['mode'],
      ...(audience.mode === 'club'
        ? { clubId: audience.clubId as string }
        : {}),
      ...(audience.mode === 'users'
        ? { memberIds: [...new Set(audience.memberIds as string[])] }
        : {}),
    },
  };
}

export function announcementFingerprint(
  input: AnnouncementInput,
  recipients: AnnouncementRecipient[],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        subject: input.subject,
        html: input.html,
        emails: recipients.map((recipient) => recipient.email).sort(),
      }),
    )
    .digest('hex');
}
