import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TeamMatchingPageComponent } from './team-matching-page.component';

describe('TeamMatchingPageComponent', () => {
  let fixture: ComponentFixture<TeamMatchingPageComponent>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TeamMatchingPageComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TeamMatchingPageComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  function clickButton(label: string) {
    const button = Array.from(element.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );

    expect(button).toBeTruthy();
    button!.click();
    fixture.detectChanges();
  }

  it('skips player matching and imports teams from CSV', () => {
    clickButton('Skip to adding teams');

    expect(element.querySelector('#roster-heading')).toBeNull();
    expect(element.querySelector('#direct-teams-heading')?.textContent).toContain(
      'Ready for pools',
    );

    const textarea = element.querySelector<HTMLTextAreaElement>(
      '.direct-teams-panel textarea',
    )!;
    textarea.value = [
      'Team No Dink,Alex,Vitto',
      'Alpha Team,Jenn,Bryan',
      'Eagles,Dino,James',
    ].join('\n');
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    clickButton('Import teams');

    expect(element.querySelector('#pools-heading')?.textContent).toContain(
      'Randomize team pools',
    );
    expect(element.textContent).toContain('3 teams');

    const poolCount = element.querySelector<HTMLInputElement>('.pool-count-control input')!;
    poolCount.value = '1';
    poolCount.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    clickButton('Randomize pools');
    clickButton('Generate schedule');

    expect(element.querySelector('.schedule-slot')?.textContent).toContain('Time slot 1');
  });

  it('uses manually entered teams for pool randomization', () => {
    clickButton('Skip to adding teams');

    const values = ['Team One', 'Alex', 'Vitto', 'Team Two', 'Jenn', 'Bryan'];
    const inputs = element.querySelectorAll<HTMLInputElement>(
      '.direct-team-row:not(.player-row-heading) input',
    );

    inputs.forEach((input, index) => {
      input.value = values[index];
      input.dispatchEvent(new Event('input'));
    });
    fixture.detectChanges();
    clickButton('Continue to pools');

    expect(element.querySelector('#pools-heading')?.textContent).toContain(
      'Randomize team pools',
    );
  });
});