import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { getApiBaseUrl } from '../api-base-url';

interface MemberRegistration {
  name: string;
  email: string;
  contactNo: string;
  emergencyContact: string;
  age: number | null;
  gender: string;
  duprId: string;
  reClubId: string;
  profileImageUrl: string;
  password: string;
  skills: Record<string, number | null>;
}

@Component({
  selector: 'app-member-registration-page',
  imports: [FormsModule],
  templateUrl: './member-registration-page.component.html',
  styleUrl: './member-registration-page.component.scss',
})
export class MemberRegistrationPageComponent {
  private readonly http = inject(HttpClient);
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
  protected readonly member: MemberRegistration = {
    name: '',
    email: '',
    contactNo: '',
    emergencyContact: '',
    age: null,
    gender: '',
    duprId: '',
    reClubId: '',
    profileImageUrl: '',
    password: '',
    skills: Object.fromEntries(this.skillFields.map(([key]) => [key, null])),
  };

  protected submitRegistration() {
    if (this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    this.registrationMessage.set('');
    this.http
      .post<{ memberId: string; registered: true }>(
        `${getApiBaseUrl()}/members/register`,
        this.member,
      )
      .subscribe({
        next: () => {
          this.member.password = '';
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