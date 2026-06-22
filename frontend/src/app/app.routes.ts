import { Routes } from '@angular/router';
import { App } from './app';
import { MonthlyParticipationPageComponent } from './monthly-participation/monthly-participation-page.component';

export const routes: Routes = [
	{
		path: '',
		component: App,
		title: 'Pickleball Queue',
	},
	{
		path: 'open-play-participation',
		component: MonthlyParticipationPageComponent,
		title: 'Open Play Participation',
	},
	{
		path: '**',
		redirectTo: '',
	},
];
