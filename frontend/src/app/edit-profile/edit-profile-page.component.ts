import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  ImageCroppedEvent,
  ImageCropperComponent,
  ImageTransform,
} from 'ngx-image-cropper';
import { getApiBaseUrl } from '../api-base-url';
import {
  MemberAccountDetails,
  MemberAuthService,
} from '../member-auth.service';

interface EditableMemberProfile {
  name: string;
  contactNo: string;
  emergencyContact: string;
  age: number | null;
  gender: string;
  duprId: string;
  reClubId: string;
  skills: Record<string, number | null>;
}

@Component({
  selector: 'app-edit-profile-page',
  imports: [FormsModule, ImageCropperComponent],
  templateUrl: './edit-profile-page.component.html',
  styleUrl: './edit-profile-page.component.scss',
})
export class EditProfilePageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(MemberAuthService);
  private readonly router = inject(Router);

  protected readonly skillFields = [
    ['serve', 'Serve'], ['return', 'Return'], ['drive', 'Drive'], ['drop', 'Drop'],
    ['dink', 'Dink'], ['volley', 'Volley'], ['lob', 'Lob'], ['overhead', 'Overhead'],
    ['reset', 'Reset'], ['block', 'Block'], ['speedUp', 'Speed-up'], ['counter', 'Counter'],
    ['flick', 'Flick'], ['roll', 'Roll'], ['attack', 'Attack'], ['defense', 'Defense'],
    ['footwork', 'Footwork'], ['positioning', 'Positioning'], ['courtCoverage', 'Court Coverage'],
    ['consistency', 'Consistency'], ['accuracy', 'Accuracy'], ['shotPlacement', 'Shot Placement'],
    ['shotSelection', 'Shot Selection'], ['courtAwareness', 'Court Awareness'],
    ['communication', 'Communication'],
  ] as const;
  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly successMessage = signal('');
  protected readonly email = signal('');
  protected readonly currentProfileImageUrl = signal('');
  protected readonly sourceProfileImage = signal<File | null>(null);
  protected readonly selectedProfileImage = signal<File | null>(null);
  protected readonly croppedImageUrl = signal<string | null>(null);
  protected readonly cropError = signal('');
  protected readonly cropZoom = signal(1);
  protected readonly cropRotation = signal(0);
  protected readonly imageTransform = computed<ImageTransform>(() => ({
    scale: this.cropZoom(),
    rotate: this.cropRotation(),
  }));
  protected readonly profile: EditableMemberProfile = {
    name: '',
    contactNo: '',
    emergencyContact: '',
    age: null,
    gender: '',
    duprId: '',
    reClubId: '',
    skills: Object.fromEntries(this.skillFields.map(([key]) => [key, 0])),
  };

  ngOnInit() {
    this.loadAccount();
  }

  protected loadAccount() {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.http
      .get<MemberAccountDetails>(`${getApiBaseUrl()}/members/me`, {
        withCredentials: true,
      })
      .subscribe({
        next: (account) => {
          this.email.set(account.email);
          this.currentProfileImageUrl.set(account.profileImageUrl);
          Object.assign(this.profile, {
            name: account.name,
            contactNo: account.contactNo,
            emergencyContact: account.emergencyContact,
            age: account.age,
            gender: account.gender,
            duprId: account.duprId,
            reClubId: account.reClubId,
            skills: { ...this.profile.skills, ...account.skills },
          });
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
          this.errorMessage.set('Unable to load your profile details. Please try again.');
        },
      });
  }

  protected saveProfile() {
    if (this.isSaving()) {
      return;
    }

    if (this.sourceProfileImage() && !this.selectedProfileImage()) {
      this.errorMessage.set('Finish cropping the profile image before saving.');
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    const update = new FormData();
    for (const [field, value] of Object.entries(this.profile)) {
      update.append(
        field,
        field === 'skills' ? JSON.stringify(value) : String(value ?? ''),
      );
    }
    const profileImage = this.selectedProfileImage();
    if (profileImage) {
      update.append('profileImage', profileImage, profileImage.name);
    }

    this.http
      .patch<MemberAccountDetails>(`${getApiBaseUrl()}/members/me`, update, {
        withCredentials: true,
      })
      .subscribe({
        next: (account) => {
          this.email.set(account.email);
          this.currentProfileImageUrl.set(account.profileImageUrl);
          this.sourceProfileImage.set(null);
          this.selectedProfileImage.set(null);
          this.croppedImageUrl.set(null);
          this.auth.updateAuthenticatedMember(account);
          this.successMessage.set('Profile changes saved.');
          this.isSaving.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage.set(
            error.error?.message ?? 'Unable to save your profile. Please try again.',
          );
          this.isSaving.set(false);
        },
      });
  }

  protected selectProfileImage(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    this.cropError.set('');
    this.sourceProfileImage.set(null);
    this.selectedProfileImage.set(null);
    this.croppedImageUrl.set(null);
    this.cropZoom.set(1);
    this.cropRotation.set(0);

    if (!file) {
      return;
    }

    if (!acceptedTypes.includes(file.type) || file.size > 10 * 1024 * 1024) {
      this.cropError.set(
        'Choose a JPEG, PNG, WebP, or GIF image that is 10 MB or smaller.',
      );
      input.value = '';
      return;
    }

    this.sourceProfileImage.set(file);
  }

  protected updateCroppedImage(event: ImageCroppedEvent) {
    if (!event.blob || !event.objectUrl) {
      return;
    }

    this.selectedProfileImage.set(
      new File([event.blob], 'profile-image.webp', {
        type: 'image/webp',
        lastModified: Date.now(),
      }),
    );
    this.croppedImageUrl.set(event.objectUrl);
    this.cropError.set('');
  }

  protected rotateCrop(degrees: number) {
    this.cropRotation.update((rotation) => rotation + degrees);
  }

  protected updateCropZoom(value: string) {
    this.cropZoom.set(Number(value));
  }

  protected imageLoadFailed() {
    this.sourceProfileImage.set(null);
    this.selectedProfileImage.set(null);
    this.croppedImageUrl.set(null);
    this.cropError.set('This image could not be loaded. Choose another file.');
  }

  protected viewProfile() {
    void this.router.navigate(['/member-profile']);
  }
}