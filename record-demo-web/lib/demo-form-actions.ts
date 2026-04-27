'use server';

export async function getSingleForm() {
  return { success: true as const, data: null };
}

export async function getClientSubmissions(_clientId: string) {
  return { success: true as const, data: [] as unknown[] };
}

export async function createSubmission(..._args: unknown[]) {
  return { success: true as const, id: 'demo-submission' };
}

export async function sendSubmissionToNutritionist(..._args: unknown[]) {
  return { success: true as const };
}

export async function saveSingleForm(_questions: unknown[], _deleteOldForms = true) {
  return { success: true as const };
}
