import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MemberRegistrationPageComponent } from './member-registration-page.component';

describe('MemberRegistrationPageComponent', () => {
  it('should submit the cropped WebP profile image instead of the original file', async () => {
    await TestBed.configureTestingModule({
      imports: [MemberRegistrationPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(MemberRegistrationPageComponent);
    const component = fixture.componentInstance as any;
    const http = TestBed.inject(HttpTestingController);
    const original = new File(['original'], 'portrait.png', { type: 'image/png' });
    const croppedBlob = new Blob(['cropped'], { type: 'image/webp' });
    component.member.password = 'strong-password';
    component.member.passwordConfirmation = 'strong-password';
    component.agreedToTerms = true;
    component.member.contactNo = '9123456789';
    component.member.emergencyContact = '9987654321';

    component.selectProfileImage({
      target: { files: [original], value: '' },
    } as unknown as Event);
    component.updateCroppedImage({
      blob: croppedBlob,
      objectUrl: 'blob:cropped-preview',
      width: 800,
      height: 1000,
      cropperPosition: {},
      imagePosition: {},
    });
    component.submitRegistration();

    const request = http.expectOne(
      ({ url, method }) => method === 'POST' && url.endsWith('/members/register'),
    );
    const body = request.request.body as FormData;
    expect(body.get('contactNo')).toBe('+639123456789');
    expect(body.get('emergencyContact')).toBe('+639987654321');
    const uploadedImage = body.get('profileImage') as File;

    expect(uploadedImage).toBeInstanceOf(File);
    expect(uploadedImage.name).toBe('portrait-profile.webp');
    expect(uploadedImage.type).toBe('image/webp');
    expect(await uploadedImage.text()).toBe('cropped');
    expect(uploadedImage).not.toBe(original);

    request.flush({ memberId: 'member-1', registered: true, verificationSent: true });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Check your email');
    http.verify();
  });

  it('requires agreement before enabling registration or submitting', async () => {
    await TestBed.configureTestingModule({
      imports: [MemberRegistrationPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(MemberRegistrationPageComponent);
    const component = fixture.componentInstance as any;
    const http = TestBed.inject(HttpTestingController);
    component.member.password = 'strong-password';
    component.member.passwordConfirmation = 'strong-password';
    component.member.contactNo = '9123456789';
    component.member.emergencyContact = '9987654321';
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const checkbox = fixture.nativeElement.querySelector('input[name="termsAgreement"]') as HTMLInputElement;
    const submit = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    const link = fixture.nativeElement.querySelector('.terms-agreement a') as HTMLAnchorElement;
    expect(checkbox.required).toBe(true);
    expect(submit.disabled).toBe(true);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');

    component.submitRegistration();
    http.expectNone(({ url }) => url.endsWith('/members/register'));
    expect(fixture.componentInstance['registrationMessage']()).toContain('Agree');

    checkbox.click();
    fixture.detectChanges();
    expect(checkbox.checked).toBe(true);
    expect(component.agreedToTerms).toBe(true);
    http.verify();
  });

  it('rejects invalid Philippine mobile numbers before sending registration', async () => {
    await TestBed.configureTestingModule({
      imports: [MemberRegistrationPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(MemberRegistrationPageComponent);
    const component = fixture.componentInstance as any;
    const http = TestBed.inject(HttpTestingController);
    component.agreedToTerms = true;
    component.member.contactNo = '09123456789';
    component.member.emergencyContact = '9987654321';
    component.submitRegistration();
    http.expectNone(({ url }) => url.endsWith('/members/register'));
    expect(component.registrationMessage()).toContain('10 digits starting with 9');
    http.verify();
  });
});
