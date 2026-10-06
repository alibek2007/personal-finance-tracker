export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Delivery is behind an interface so a real provider (SES, Postmark, SMTP) is a drop-in later. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Fallback transport that writes to the API log instead of sending. In development the body is
 * included (it carries the one-time link you need to click); in production it never is, because
 * those links are credentials.
 */
export class ConsoleMailer implements Mailer {
  constructor(
    private readonly log: (obj: object, msg: string) => void,
    private readonly includeBody: boolean,
  ) {}
  async send(message: MailMessage): Promise<void> {
    this.log(
      {
        to: message.to,
        subject: message.subject,
        ...(this.includeBody ? { body: message.text } : {}),
      },
      'email NOT sent: no mail provider configured (console transport)',
    );
  }
}

/** Test transport: remembers what was sent. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}
