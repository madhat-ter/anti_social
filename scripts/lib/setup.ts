/**
 * Since RFC §10.3 every seated member lands on /setup right after joining. Screenshot scripts call
 * this after the recovery-code step: it fills in About you, a gender, a birthday and contact details, then waits for
 * the feed. People who joined into the waiting line never see setup; then it returns false.
 */
import type { Page } from 'playwright-core';

export const SETUP_ABOUT = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');

export async function finishSetup(page: Page, gender = 'Prefer not to say', birthday = '1996-04-02'): Promise<boolean> {
  try {
    await page.getByRole('heading', { name: 'Set up your profile' }).waitFor({ timeout: 8000 });
  } catch {
    return false;
  }
  await page.locator('#su-about-text').fill(SETUP_ABOUT);
  await page.getByLabel(gender, { exact: true }).check();
  await page.getByLabel('Your birthday', { exact: true }).fill(birthday);
  // RFC §10.7: contact details for admins (asked while the server has CONTACT_KEY, or outside production)
  if (await page.getByLabel('Cell phone', { exact: true }).count()) {
    await page.getByLabel('Cell phone', { exact: true }).fill('+977 980 000 0000');
    await page.getByLabel('Email', { exact: true }).fill('member@example.com');
  }
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByPlaceholder('What is on your mind?').waitFor();
  return true;
}