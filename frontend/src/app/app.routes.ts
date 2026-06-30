import { Routes } from '@angular/router';
import { App } from './app';
import { dashboardAuthGuard } from './dashboard-auth.guard';
import { MonthlyParticipationPageComponent } from './monthly-participation/monthly-participation-page.component';
import { ParticipationUploadPageComponent } from './participation-upload/participation-upload-page.component';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'open-play-participation',
  },
  {
    path: 'queue-dashboard',
    component: App,
    canActivate: [dashboardAuthGuard],
    title: 'Pickleball Queue',
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
    path: '**',
    redirectTo: 'open-play-participation',
  },
];
