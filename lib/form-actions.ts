'use server';

import { query, queryOne, insert, execute, generateUUID } from './mysql';
import { FormSchema, Question, FilledForm, Answer, QuestionType } from './form-types';
import { revalidatePath } from 'next/cache';

// --- FORM ACTIONS ---

export async function saveForm(schema: FormSchema) {
    try {
        // 1. Insert Form
        const formId = generateUUID();
        await insert(
            'INSERT INTO forms (id, title, description) VALUES (?, ?, ?)',
            [formId, schema.title, 'Created via Form Builder']
        );

        // 2. Insert Questions
        for (const [index, q] of schema.questions.entries()) {
            const questionId = generateUUID();
            await insert(
                'INSERT INTO questions (id, form_id, text, type, options, conditional_text_inputs, `order`) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    questionId,
                    formId,
                    q.text,
                    q.type,
                    q.options ? JSON.stringify(q.options) : null,
                    q.conditionalTextInputs ? JSON.stringify(q.conditionalTextInputs) : null,
                    index
                ]
            );
        }

        revalidatePath('/forms');
        return { success: true, formId };
    } catch (error: any) {
        console.error('Error saving form:', error);
        return { success: false, error: error.message };
    }
}

export async function getForms() {
    try {
        const data = await query<any>('SELECT * FROM forms ORDER BY created_at DESC');
        return { success: true, data };
    } catch (error: any) {
        console.error('Error fetching forms:', error);
        return { success: false, error: error.message };
    }
}

export async function getForm(formId: string): Promise<{ success: boolean; data?: FormSchema; error?: string }> {
    try {
        // Fetch form details
        const form = await queryOne<any>('SELECT * FROM forms WHERE id = ?', [formId]);
        if (!form) throw new Error('Form not found');

        // Fetch questions
        const questionsData = await query<any>(
            'SELECT * FROM questions WHERE form_id = ? ORDER BY `order` ASC',
            [formId]
        );

        // Map to FormSchema
        const questions: Question[] = questionsData.map((q: any) => ({
            id: q.id,
            type: q.type,
            text: q.text,
            options: q.options ? JSON.parse(q.options) : undefined,
            conditionalTextInputs: q.conditional_text_inputs ? JSON.parse(q.conditional_text_inputs) : undefined
        }));

        return {
            success: true,
            data: {
                id: form.id,
                title: form.title,
                questions
            }
        };

    } catch (error: any) {
        console.error('Error fetching form:', error);
        return { success: false, error: error.message };
    }
}

// --- SUBMISSION ACTIONS ---

export async function submitForm(formId: string, answers: Record<string, string>) {
    try {
        // 1. Create Submission (Filled Form)
        const submissionId = generateUUID();
        await insert(
            'INSERT INTO filled_forms (id, form_id) VALUES (?, ?)',
            [submissionId, formId]
        );

        // 2. Save Answers
        for (const [questionId, value] of Object.entries(answers)) {
            const answerId = generateUUID();
            await insert(
                'INSERT INTO form_answers (id, filled_form_id, question_id, value) VALUES (?, ?, ?, ?)',
                [answerId, submissionId, questionId, value]
            );
        }

        revalidatePath('/forms');
        return { success: true, submissionId };

    } catch (error: any) {
        console.error('Error submitting form:', error);
        return { success: false, error: error.message };
    }
}

const SCREENING_FORM_TITLE = "Screening Form";

export async function saveSingleForm(questions: any[], deleteOldForms: boolean = true) {
    try {
        // Always create a new form
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const formTitle = `${SCREENING_FORM_TITLE} - ${timestamp}`;

        // 1. Create new form
        const formId = generateUUID();
        await insert(
            'INSERT INTO forms (id, title, description) VALUES (?, ?, ?)',
            [formId, formTitle, 'Global Screening Form']
        );

        // 2. Insert new questions
        if (questions.length > 0) {
            for (const [index, q] of questions.entries()) {
                const questionId = generateUUID();
                await insert(
                    'INSERT INTO questions (id, form_id, text, type, options, conditional_text_inputs, `order`) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [
                        questionId,
                        formId,
                        q.text,
                        q.type,
                        q.options ? JSON.stringify(q.options) : null,
                        q.conditionalTextInputs ? JSON.stringify(q.conditionalTextInputs) : null,
                        index
                    ]
                );
            }
        }

        // 3. Delete old forms if requested (after successfully creating the new one)
        if (deleteOldForms) {
            // Get all old screening forms (excluding the one we just created)
            const oldForms = await query<any>(
                'SELECT id FROM forms WHERE title LIKE ? AND id != ?',
                [`${SCREENING_FORM_TITLE}%`, formId]
            );

            if (oldForms && oldForms.length > 0) {
                // Delete old forms (cascade will delete their questions)
                const oldFormIds = oldForms.map(f => f.id);
                const placeholders = oldFormIds.map(() => '?').join(',');
                try {
                    await execute(`DELETE FROM forms WHERE id IN (${placeholders})`, oldFormIds);
                } catch (deleteError) {
                    console.error('Error deleting old forms:', deleteError);
                    // Don't fail the whole operation if deletion fails
                }
            }
        }

        revalidatePath('/forms');
        return { success: true, formId };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getSingleForm() {
    try {
        // Get the most recent screening form (forms with title starting with "Screening Form")
        // This allows multiple forms to exist, but we use the latest one
        const forms = await query<any>(
            'SELECT id, title, description, created_at FROM forms WHERE title LIKE ? ORDER BY created_at DESC LIMIT 1',
            [`${SCREENING_FORM_TITLE}%`]
        );

        if (!forms || forms.length === 0) {
            // No screening forms found, return null (not an error, just empty)
            return { success: true, data: null };
        }

        const form = forms[0];

        const questions = await query<any>(
            'SELECT * FROM questions WHERE form_id = ? ORDER BY `order` ASC',
            [form.id]
        );

        const schema: FormSchema = {
            id: form.id,
            title: SCREENING_FORM_TITLE, // Return the base title for display
            questions: questions.map((q: any) => ({ // Explicit typing to fix implicit any
                id: q.id,
                type: q.type as QuestionType,
                text: q.text,
                options: q.options ? JSON.parse(q.options as unknown as string) : undefined,
                conditionalTextInputs: q.conditional_text_inputs ? JSON.parse(q.conditional_text_inputs as unknown as string) : undefined
            }))
        };

        return { success: true, data: schema };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

// --- FILE STORAGE (R2) ---

import { uploadFile } from './storage';

export async function uploadFormPdf(formData: FormData) {
    try {
        const file = formData.get('file') as File;
        if (!file) {
            throw new Error('No file provided');
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const timestamp = new Date().getTime();
        const filename = `screening-form-${timestamp}.pdf`; // Simple unique key

        const { success, key } = await uploadFile(filename, buffer, 'application/pdf');

        if (!success) {
            throw new Error('Upload failed');
        }

        return { success: true, key };
    } catch (error: any) {
        console.error('Error uploading PDF:', error);
        return { success: false, error: error.message };
    }
}

// --- SUBMISSION MANAGEMENT (Verification Flow) ---

export async function createSubmission(data: Record<string, string>, clientId?: string) {
    try {
        // Get the Screening Form ID
        const formResult = await getSingleForm();
        if (!formResult.success || !formResult.data) {
            throw new Error('Screening Form not found');
        }

        // Delete old pending submissions for this client and form before creating a new one
        if (clientId) {
            try {
                await execute(
                    'DELETE FROM form_submissions WHERE client_id = ? AND form_id = ? AND status = ?',
                    [clientId, formResult.data.id, 'pending']
                );
            } catch (deleteError) {
                console.error('Error deleting old pending submissions:', deleteError);
                // Don't fail the whole operation if deletion fails, but log it
            }
        }

        const submissionId = generateUUID();
        const token = generateUUID();
        await insert(
            'INSERT INTO form_submissions (id, form_id, client_id, token, status, data) VALUES (?, ?, ?, ?, ?, ?)',
            [submissionId, formResult.data.id, clientId || null, token, 'pending', JSON.stringify(data)]
        );

        const submission = { id: submissionId, token, form_id: formResult.data.id, client_id: clientId || null, status: 'pending', data };

        // Set screening status to waiting_approval when form is submitted
        if (clientId) {
            try {
                await execute(
                    'UPDATE clients SET screening_status = ? WHERE id = ?',
                    ['waiting_approval', clientId]
                );
            } catch (updateError) {
                console.error('Failed to update screening status:', updateError);
                // Don't fail the submission if this fails
            }
        }

        return { success: true, token: submission.token, submissionId: submission.id };
    } catch (error: any) {
        console.error('Error creating submission:', error);
        return { success: false, error: error.message };
    }
}

export async function getSubmissionByToken(token: string) {
    try {
        const submission = await queryOne<any>(
            'SELECT * FROM form_submissions WHERE token = ?',
            [token]
        );

        if (!submission) throw new Error('Submission not found');

        // Also fetch the form schema
        const formResult = await getForm(submission.form_id);
        if (!formResult.success || !formResult.data) {
            throw new Error('Form not found');
        }

        // Fetch client info if client_id exists
        let client = null;
        if (submission.client_id) {
            client = await getClient(submission.client_id);
        }

        return {
            success: true,
            data: {
                submission,
                formSchema: formResult.data,
                client
            }
        };
    } catch (error: any) {
        console.error('Error fetching submission:', error);
        return { success: false, error: error.message };
    }
}

export async function updateSubmissionStatus(token: string, status: 'accepted' | 'rejected', signatureDataUrl?: string, comments?: string) {
    try {
        let signatureUrl = null;

        // If signature provided, upload it
        if (signatureDataUrl && status === 'accepted') {
            const base64Data = signatureDataUrl.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            const timestamp = new Date().getTime();
            const filename = `signature-${timestamp}.png`;

            const { success, key } = await uploadFile(filename, buffer, 'image/png');
            if (success) {
                signatureUrl = key;
            }
        }

        const updates: string[] = ['status = ?'];
        const params: any[] = [status];
        
        if (signatureUrl) {
            updates.push('signature_url = ?');
            params.push(signatureUrl);
        }
        if (comments) {
            updates.push('comments = ?');
            params.push(comments);
        }
        
        params.push(token);
        
        await execute(
            `UPDATE form_submissions SET ${updates.join(', ')} WHERE token = ?`,
            params
        );

        // Get client_id from submission
        const updatedSubmission = await queryOne<any>(
            'SELECT client_id FROM form_submissions WHERE token = ?',
            [token]
        );

        // Update client screening_status based on submission status
        if (updatedSubmission?.client_id) {
            const newScreeningStatus = status === 'accepted' ? 'approved' : 'rejected';
            try {
                await execute(
                    'UPDATE clients SET screening_status = ? WHERE id = ?',
                    [newScreeningStatus, updatedSubmission.client_id]
                );
            } catch (clientUpdateError) {
                console.error('Failed to update client screening status:', clientUpdateError);
                // Don't fail the submission if this fails
            }
        }

        return { success: true };
    } catch (error: any) {
        console.error('Error updating submission status:', error);
        return { success: false, error: error.message };
    }
}

export async function finalizeSubmission(token: string, pdfBlob: Blob) {
    try {
        const buffer = Buffer.from(await pdfBlob.arrayBuffer());
        const timestamp = new Date().getTime();
        const filename = `signed-order-${timestamp}.pdf`;

        const { success, key } = await uploadFile(filename, buffer, 'application/pdf');

        if (!success) {
            throw new Error('PDF upload failed');
        }

        await execute(
            'UPDATE form_submissions SET pdf_url = ? WHERE token = ?',
            [key, token]
        );

        return { success: true, pdfUrl: key };
    } catch (error: any) {
        console.error('Error finalizing submission:', error);
        return { success: false, error: error.message };
    }
}

export async function getClientSubmissions(clientId: string) {
    try {
        const data = await query<any>(
            'SELECT * FROM form_submissions WHERE client_id = ? ORDER BY created_at DESC',
            [clientId]
        );

        return { success: true, data };
    } catch (error: any) {
        console.error('Error fetching client submissions:', error);
        return { success: false, error: error.message };
    }
}

// --- EMAIL ACTIONS ---

import { sendEmail } from './email';
import { getNutritionists } from './actions';
import { getClient } from './actions';

export async function sendSubmissionToNutritionist(
    nutritionistId: string,
    submissionData: Record<string, string>,
    clientId?: string,
    token?: string
): Promise<{ success: boolean; error?: string }> {
    try {
        // Get nutritionist
        const nutritionists = await getNutritionists();
        const nutritionist = nutritionists.find(n => n.id === nutritionistId);
        
        if (!nutritionist) {
            return { success: false, error: 'Nutritionist not found' };
        }

        if (!nutritionist.email) {
            return { success: false, error: 'Nutritionist does not have an email address' };
        }

        // Get client info if available
        let clientInfo = '';
        if (clientId) {
            const client = await getClient(clientId);
            if (client) {
                clientInfo = `<p><strong>Client:</strong> ${client.fullName}</p>`;
            }
        }

        // Get form schema to format the submission nicely
        const formResult = await getSingleForm();
        let submissionHtml = '<h2>New Form Submission</h2>';
        
        if (clientInfo) {
            submissionHtml += clientInfo;
        }

        submissionHtml += '<hr style="margin: 20px 0;">';
        submissionHtml += '<h3>Submission Details:</h3>';
        submissionHtml += '<ul style="list-style: none; padding: 0;">';

        if (formResult.success && formResult.data) {
            // Format with question text
            formResult.data.questions.forEach((question, index) => {
                const answer = submissionData[question.id];
                const conditionalAnswer = submissionData[`${question.id}_conditional`];
                
                if (answer) {
                    submissionHtml += `<li style="margin-bottom: 15px; padding: 10px; background-color: #f5f5f5; border-radius: 5px;">`;
                    submissionHtml += `<strong>${index + 1}. ${question.text}</strong><br>`;
                    submissionHtml += `<span>${answer}</span>`;
                    
                    if (conditionalAnswer) {
                        submissionHtml += `<br><em style="margin-top: 5px; display: block;">Additional details: ${conditionalAnswer}</em>`;
                    }
                    
                    submissionHtml += `</li>`;
                }
            });
        } else {
            // Fallback: just show raw data
            Object.entries(submissionData).forEach(([key, value]) => {
                if (!key.endsWith('_conditional')) {
                    submissionHtml += `<li style="margin-bottom: 10px;"><strong>${key}:</strong> ${value}</li>`;
                }
            });
        }

        submissionHtml += '</ul>';
        submissionHtml += '<hr style="margin: 20px 0;">';
        submissionHtml += `<p style="color: #666; font-size: 12px;">Submitted at: ${new Date().toLocaleString()}</p>`;

        // Add approval/denial link if token is provided
        if (token) {
            // Get base URL from environment variable or use a default
            let baseUrl = process.env.NEXT_PUBLIC_APP_URL;
            if (!baseUrl && process.env.NEXT_PUBLIC_VERCEL_URL) {
                baseUrl = `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
            }
            if (!baseUrl) {
                baseUrl = 'http://localhost:3000';
            }
            const approvalUrl = `${baseUrl}/verify-order/${token}`;
            
            submissionHtml += '<hr style="margin: 20px 0;">';
            submissionHtml += '<div style="text-align: center; padding: 20px; background-color: #f0f9ff; border-radius: 8px; margin-top: 30px;">';
            submissionHtml += '<h3 style="margin-top: 0; color: #1e40af;">Review & Approve Submission</h3>';
            submissionHtml += '<p style="margin-bottom: 20px; color: #1f2937;">Click the link below to review and approve or deny this submission:</p>';
            submissionHtml += `<a href="${approvalUrl}" style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Review Submission</a>`;
            submissionHtml += `<p style="margin-top: 15px; font-size: 12px; color: #6b7280;">Or copy and paste this link into your browser:<br><span style="word-break: break-all;">${approvalUrl}</span></p>`;
            submissionHtml += '</div>';
        }

        // Send email
        const emailResult = await sendEmail({
            to: nutritionist.email,
            subject: `New Form Submission${clientId ? ' - Client Form' : ''}`,
            html: submissionHtml
        });

        return emailResult;
    } catch (error: any) {
        console.error('Error sending submission to nutritionist:', error);
        return { success: false, error: error.message || 'Failed to send submission' };
    }
}
