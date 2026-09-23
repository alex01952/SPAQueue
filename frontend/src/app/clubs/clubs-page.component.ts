import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-clubs-page',
  imports: [RouterLink],
  templateUrl: './clubs-page.component.html',
  styleUrl: './clubs-page.component.scss',
})
export class ClubsPageComponent {
  protected readonly logoUrl =
    'https://seeturtlesphsa.blob.core.windows.net/spa/Assets/Logo.png';
}