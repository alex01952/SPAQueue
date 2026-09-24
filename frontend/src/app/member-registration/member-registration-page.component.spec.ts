import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
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

    const request = http.expectOne(({ url, method }) =>
      method === 'POST' && url.endsWith('/members/register'),
    );
    const body = request.request.body as FormData;
    const uploadedImage = body.get('profileImage') as File;

    expect(uploadedImage).toBeInstanceOf(File);
    expect(uploadedImage.name).toBe('portrait-profile.webp');
    expect(uploadedImage.type).toBe('image/webp');
    expect(await uploadedImage.text()).toBe('cropped');
    expect(uploadedImage).not.toBe(original);

    request.flush({ memberId: 'member-1', registered: true });
    http.verify();
  });
});