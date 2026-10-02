import { Component, computed, inject, input, output } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

@Component({
  selector: 'app-member-profile-frame',
  templateUrl: './member-profile-frame.component.html',
  styleUrl: './member-profile-frame.component.scss',
})
export class MemberProfileFrameComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly memberId = input.required<string>();
  readonly memberName = input.required<string>();
  readonly closed = output<void>();
  protected readonly profileUrl = computed(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(
      `/member-profile/${encodeURIComponent(this.memberId())}`,
    ),
  );
}