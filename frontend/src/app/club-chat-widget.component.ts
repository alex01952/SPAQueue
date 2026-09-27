import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnDestroy, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { getApiBaseUrl } from './api-base-url';

interface ClubChatMessage {
  messageId: string;
  senderId: string;
  senderName: string;
  text: string;
  sentAt: string;
}

@Component({
  selector: 'app-club-chat-widget',
  imports: [DatePipe, FormsModule],
  templateUrl: './club-chat-widget.component.html',
  styleUrl: './club-chat-widget.component.scss',
})
export class ClubChatWidgetComponent implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private isLoadingMessages = false;

  protected readonly isOpen = signal(false);
  protected readonly messages = signal<ClubChatMessage[]>([]);
  protected readonly draft = signal('');
  protected readonly isSending = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly errorMessage = signal('');

  protected toggle() {
    if (this.isOpen()) {
      this.stopPolling();
      this.isOpen.set(false);
      return;
    }

    this.isOpen.set(true);
    this.loadMessages();
    this.pollHandle = setInterval(() => this.loadMessages(), 8000);
  }

  protected sendMessage() {
    const text = this.draft().trim();
    if (!text || text.length > 1000 || this.isSending()) return;

    this.isSending.set(true);
    this.errorMessage.set('');
    this.http
      .post<ClubChatMessage>(
        `${getApiBaseUrl()}/chat/messages`,
        { text },
        { withCredentials: true },
      )
      .subscribe({
        next: (message) => {
          this.messages.update((items) => {
            const next = items.filter((item) => item.messageId !== message.messageId);
            next.push(message);
            return next.slice(-50);
          });
          this.draft.set('');
          this.isSending.set(false);
          this.loadMessages();
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(
            error.error?.message ?? 'Unable to send your message. Try again.',
          );
          this.isSending.set(false);
        },
      });
  }

  ngOnDestroy() {
    this.stopPolling();
  }

  private loadMessages() {
    if (this.isLoadingMessages || !this.isOpen()) return;
    this.isLoadingMessages = true;
    this.isLoading.set(this.messages().length === 0);

    this.http
      .get<ClubChatMessage[]>(`${getApiBaseUrl()}/chat/messages`, {
        withCredentials: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (messages) => {
          this.messages.set(messages);
          this.isLoading.set(false);
          this.isLoadingMessages = false;
          this.errorMessage.set('');
        },
        error: (error: HttpErrorResponse) => {
          this.isLoading.set(false);
          this.isLoadingMessages = false;
          this.errorMessage.set(
            error.status === 401
              ? 'Your session expired. Sign in again to use club chat.'
              : error.error?.message ?? 'Unable to load club messages.',
          );
        },
      });
  }

  private stopPolling() {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }
}
