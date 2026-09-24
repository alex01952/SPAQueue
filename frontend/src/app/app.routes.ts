import { Routes } from '@angular/router';
import { App } from './app';
import { ClubsPageComponent } from './clubs/clubs-page.component';
import { dashboardAuthGuard } from './dashboard-auth.guard';
import { EditProfilePageComponent } from './edit-profile/edit-profile-page.component';
import { HomePageComponent } from './home/home-page.component';
import { MemberProfilePageComponent } from './member-profile/member-profile-page.component';
import { memberAuthGuard } from './member-auth.guard';
import { MemberLoginPageComponent } from './member-login/member-login-page.component';
import { MembersPageComponent } from './members/members-page.component';
import { MonthlyParticipationPageComponent } from './monthly-participation/monthly-participation-page.component';
import { MemberRegistrationPageComponent } from './member-registration/member-registration-page.component';
import { ParticipationUploadPageComponent } from './participation-upload/participation-upload-page.component';
import { TeamMatchingPageComponent } from './team-matching/team-matching-page.component';
import { VerifyEmailPageComponent } from './verify-email/verify-email-page.component';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'home',
  },
  {
    path: 'home',
    component: HomePageComponent,
    canActivate: [memberAuthGuard],
    title: 'Member Home',
  },
  {
    path: 'queue-dashboard',
    component: App,
    canActivate: [memberAuthGuard, dashboardAuthGuard],
    title: 'Pickleball Queue',
  },
  {
    path: 'masters-of-the-arena',
    component: MonthlyParticipationPageComponent,
    canActivate: [memberAuthGuard],
    data: { arenaMastersOnly: true },
    title: 'Masters of the Arena',
  },
  {
    path: 'open-play-participation',
    component: MonthlyParticipationPageComponent,
    title: 'Open Play Participation',
  },
  {
    path: 'open-play-participation/upload',
    component: ParticipationUploadPageComponent,
    canActivate: [dashboardAuthGuard],
    title: 'Upload Participation Files',
  },
  {
    path: 'team-matching',
    component: TeamMatchingPageComponent,
    title: 'Team Matching',
  },
  {
    path: 'login',
    component: MemberLoginPageComponent,
    title: 'Member Login',
  },
  {
    path: 'register',
    component: MemberRegistrationPageComponent,
    title: 'Member Registration',
  },
  {
    path: 'verify-email',
    component: VerifyEmailPageComponent,
    title: 'Verify Email',
  },
  {
    path: 'member-profile',
    component: MemberProfilePageComponent,
    canActivate: [memberAuthGuard],
    title: 'Member Profile',
  },
  {
    path: 'member-profile/edit',
    component: EditProfilePageComponent,
    canActivate: [memberAuthGuard],
    data: {
      breadcrumbParent: { label: 'Member Profile', route: '/member-profile' },
    },
    title: 'Edit Profile',
  },
  {
    path: 'member-profile/:memberId',
    component: MemberProfilePageComponent,
    canActivate: [memberAuthGuard],
    data: {
      breadcrumbParent: { label: 'Members', route: '/members' },
    },
    title: 'Member Profile',
  },
  {
    path: 'members',
    component: MembersPageComponent,
    canActivate: [memberAuthGuard],
    title: 'Members',
  },
  {
    path: 'clubs',
    component: ClubsPageComponent,
    canActivate: [memberAuthGuard],
    title: 'Clubs',
  },
  {
    path: '**',
    redirectTo: 'home',
  },
];
