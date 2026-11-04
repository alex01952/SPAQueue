import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, effect, input, signal } from '@angular/core';
import type { TournamentPricing } from './tournament.types';

@Component({
  selector: 'app-tournament-pricing',
  imports: [CurrencyPipe, DatePipe],
  template: `
    @if (pricing(); as fee) {
      <div class="fee-details">
        <strong>Registration fee: {{ currentPrice() | currency: 'PHP' : 'symbol' : '1.2-2' }} per player {{ earlyBirdActive() ? '(early bird)' : '(regular)' }}</strong>
        <span>Regular price: {{ fee.regularPrice | currency: 'PHP' : 'symbol' : '1.2-2' }} per player</span>
        @if (fee.earlyBirdPrice !== undefined && fee.earlyBirdEndDate) {
          <span>Early-bird price: {{ fee.earlyBirdPrice | currency: 'PHP' : 'symbol' : '1.2-2' }} per player</span>
          <span>Early bird ends {{ fee.earlyBirdEndDate + 'T23:59:59+08:00' | date: 'longDate' : '+0800' }} at 11:59 PM Philippine time (UTC+8). {{ earlyBirdActive() ? 'Regular pricing applies afterward.' : 'Early-bird pricing has ended.' }}</span>
        }
      </div>
    } @else {
      <span>Registration fee: not yet announced.</span>
    }
  `,
  styles: `
    :host { display: block; margin-top: 8px; color: var(--text-secondary); font-size: .8rem; }
    .fee-details { display: grid; gap: 5px; }
    strong { color: var(--text-primary); }
  `,
})
export class TournamentPricingComponent {
  readonly pricing = input<TournamentPricing>();
  private readonly now = signal(Date.now());
  protected readonly earlyBirdActive = computed(() => {
    const pricing = this.pricing();
    return pricing?.earlyBirdPrice !== undefined && !!pricing.earlyBirdEndDate &&
      this.now() <= Date.parse(`${pricing.earlyBirdEndDate}T23:59:59.999+08:00`);
  });
  protected readonly currentPrice = computed(() =>
    this.earlyBirdActive() ? this.pricing()?.earlyBirdPrice : this.pricing()?.regularPrice,
  );

  constructor() {
    effect((onCleanup) => {
      const pricing = this.pricing();
      this.now.set(Date.now());
      if (pricing?.earlyBirdEndDate && pricing.earlyBirdPrice !== undefined) {
        const timer = setInterval(() => this.now.set(Date.now()), 1000);
        onCleanup(() => clearInterval(timer));
      }
    });
  }
}
