import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ImageCroppedEvent,
  ImageCropperComponent,
  ImageTransform,
} from 'ngx-image-cropper';
import { getApiBaseUrl } from '../api-base-url';

interface MemberRegistration {
  name: string;
  email: string;
  contactNo: string;
  emergencyContact: string;
  birthday: string;
  showAge: boolean;
  locationType: 'Sorsogon' | 'Other' | '';
  location: string;
  gender: string;
  duprId: string;
  reClubId: string;
  profileImageUrl: string;
  password: string;
  passwordConfirmation: string;
  skills: Record<string, number | null>;
}

@Component({
  selector: 'app-member-registration-page',
  imports: [FormsModule, ImageCropperComponent],
  templateUrl: './member-registration-page.component.html',
  styleUrl: './member-registration-page.component.scss',
})
export class MemberRegistrationPageComponent {
  private readonly http = inject(HttpClient);
  protected readonly sorsogonTowns = [
    'Barcelona', 'Bulan', 'Bulusan', 'Castilla', 'Casiguran', 'Donsol',
    'Gubat', 'Irosin', 'Juban', 'Magallanes', 'Matnog', 'Pilar',
    'Prieto Diaz', 'Santa Magdalena', 'Sorsogon City',
  ];
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
  protected readonly registrationMessage = signal('');
  protected readonly isSubmitting = signal(false);
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
  protected readonly member: MemberRegistration = {
    name: '',
    email: '',
    contactNo: '',
    emergencyContact: '',
    birthday: '',
    showAge: false,
    locationType: '',
    location: '',
    gender: '',
    duprId: '',
    reClubId: '',
    profileImageUrl: '',
    password: '',
    passwordConfirmation: '',
    skills: Object.fromEntries(this.skillFields.map(([key]) => [key, 0])),
  };

  protected passwordsMatch() {
    return Boolean(this.member.password) &&
      this.member.password === this.member.passwordConfirmation;
  }

  protected skillProgress(skillKey: string) {
    const rating = this.member.skills[skillKey] ?? 0;

    return Math.min(Math.max(rating, 0), 10) * 10;
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

    if (!acceptedTypes.includes(file.type)) {
      this.cropError.set('Choose a JPEG, PNG, WebP, or GIF image.');
      input.value = '';
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      this.cropError.set('The original image must be 10 MB or smaller.');
      input.value = '';
      return;
    }

    this.sourceProfileImage.set(file);
  }

  protected updateCroppedImage(event: ImageCroppedEvent) {
    if (!event.blob || !event.objectUrl) {
      return;
    }

    const sourceName = this.sourceProfileImage()?.name ?? 'profile-image';
    const baseName = sourceName.replace(/\.[^.]+$/, '');
    this.selectedProfileImage.set(
      new File([event.blob], `${baseName}-profile.webp`, {
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

  protected submitRegistration() {
    if (this.isSubmitting()) {
      return;
    }

    if (!this.passwordsMatch()) {
      this.registrationMessage.set('Passwords do not match.');
      return;
    }

    if (this.sourceProfileImage() && !this.selectedProfileImage()) {
      this.registrationMessage.set('Finish cropping the profile image before registering.');
      return;
    }

    this.isSubmitting.set(true);
    this.registrationMessage.set('');
    const registration = new FormData();

    for (const [field, value] of Object.entries(this.member)) {
      if (field === 'passwordConfirmation') {
        continue;
      }

      registration.append(
        field,
        field === 'skills' ? JSON.stringify(value) : String(value ?? ''),
      );
    }

    const profileImage = this.selectedProfileImage();
    if (profileImage) {
      registration.append('profileImage', profileImage, profileImage.name);
    }

    this.http
      .post<{ memberId: string; registered: true }>(
        `${getApiBaseUrl()}/members/register`,
        registration,
      )
      .subscribe({
        next: () => {
          this.member.password = '';
          this.member.passwordConfirmation = '';
          this.registrationMessage.set('Registration complete. Welcome to the club.');
          this.isSubmitting.set(false);
        },
        error: (error: HttpErrorResponse) => {
          this.registrationMessage.set(
            error.error?.message ?? 'Registration could not be completed. Please try again.',
          );
          this.isSubmitting.set(false);
        },
      });
  }
}