import { Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { TournamentPricing } from './tournament.types';

export interface TournamentPricingForm {
  regularPrice: number | null;
  earlyBirdPrice: number | null;
  earlyBirdEndDate: string;
}

export function tournamentPricingForm(pricing?: TournamentPricing): TournamentPricingForm {
  return {
    regularPrice: pricing?.regularPrice ?? null,
    earlyBirdPrice: pricing?.earlyBirdPrice ?? null,
    earlyBirdEndDate: pricing?.earlyBirdEndDate ?? '',
  };
}

export function pricingFromForm(form: TournamentPricingForm): TournamentPricing | null {
  if (form.regularPrice === null && form.earlyBirdPrice === null && !form.earlyBirdEndDate) return null;
  if (form.regularPrice === null) throw new Error('Enter a regular registration price.');
  if ((form.earlyBirdPrice !== null) !== !!form.earlyBirdEndDate) {
    throw new Error('Provide both the early-bird price and its end date.');
  }
  const amounts = [form.regularPrice, ...(form.earlyBirdPrice === null ? [] : [form.earlyBirdPrice])];
  if (amounts.some((amount) => !Number.isFinite(amount) || amount < 0 || amount > 1000000 || !/^\d+(\.\d{1,2})?$/.test(String(amount)))) {
    throw new Error('Enter PHP prices from 0 to 1,000,000 with at most two decimal places.');
  }
  if (form.earlyBirdPrice !== null && form.earlyBirdPrice > form.regularPrice) {
    throw new Error('The early-bird price cannot exceed the regular price.');
  }
  if (form.earlyBirdEndDate) {
    const date = new Date(`${form.earlyBirdEndDate}T00:00:00.000Z`);
    if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(form.earlyBirdEndDate) ||
      Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== form.earlyBirdEndDate) {
      throw new Error('Enter a valid early-bird end date.');
    }
  }
  return {
    regularPrice: form.regularPrice,
    ...(form.earlyBirdPrice !== null ? {
      earlyBirdPrice: form.earlyBirdPrice, earlyBirdEndDate: form.earlyBirdEndDate,
    } : {}),
  };
}

@Component({
  selector: 'app-tournament-pricing-editor',
  imports: [FormsModule],
  template: `
    <fieldset [disabled]="disabled()">
      <legend>Registration fee (PHP per player)</legend>
      <p>Leave all fields blank if pricing is not yet set. Enter 0 for free registration.</p>
      <label><span>Regular price (PHP)</span><input type="number" name="regularPrice" [(ngModel)]="form().regularPrice" [ngModelOptions]="{ standalone: true }" min="0" max="1000000" step="0.01" /></label>
      <label><span>Early-bird price (PHP, optional)</span><input type="number" name="earlyBirdPrice" [(ngModel)]="form().earlyBirdPrice" [ngModelOptions]="{ standalone: true }" min="0" max="1000000" step="0.01" /></label>
      <label><span>Early-bird end date (Philippine time)</span><input type="date" name="earlyBirdEndDate" [(ngModel)]="form().earlyBirdEndDate" [ngModelOptions]="{ standalone: true }" min="1000-01-01" max="9999-12-31" /></label>
      <p>Early-bird pricing ends at 11:59 PM on this date in Asia/Manila (UTC+8). Regular pricing applies afterward.</p>
    </fieldset>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    fieldset { display: grid; gap: 12px; min-width: 0; margin: 0; padding: 12px; border: 1px solid rgba(103, 70, 41, .24); border-radius: 4px; }
    legend { font-size: .8rem; font-weight: 700; }
    label { display: grid; gap: 6px; color: var(--text-secondary); font-size: .76rem; font-weight: 700; }
    input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 40px; padding: 8px; color: var(--text-primary); background: #fffdf8; border: 1px solid rgba(103, 70, 41, .24); border-radius: 4px; font: inherit; }
    p { margin: 0; color: var(--text-secondary); font-size: .76rem; }
  `,
})
export class TournamentPricingEditorComponent {
  readonly form = input.required<TournamentPricingForm>();
  readonly disabled = input(false);
}
