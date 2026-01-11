'use server';

import { supabase } from './supabase';
import { FormSchema, Question, FilledForm, Answer, QuestionType } from './form-types';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';

// --- FORM ACTIONS ---

export async function saveForm(schema: FormSchema) {
    try {
        // 1. Insert Form
        const formId = randomUUID();
        const { error: formError } = await supabase
            .from('forms')
            .insert([{ id: formId, title: schema.title, description: 'Created via Form Builder' }]);
        if (formError) throw formError;

        // 2. Insert Questions
        const questionsToInsert = schema.questions.map((q, index) => ({
            id: randomUUID(),
            form_id: formId,
            text: q.text,
            type: q.type,
            options: q.options || null,
            conditional_text_inputs: q.conditionalTextInputs || null,
            order: index
        }));
        
        if (questionsToInsert.length > 0) {
            const { error: questionsError } = await supabase
                .from('questions')
                .insert(questionsToInsert);
            if (questionsError) throw questionsError;
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
        const { data, error } = await supabase.from('forms').select('*').order('created_at', { ascending: false });
        if (error) return { success: false, error: error.message };
        return { success: true, data: data || [] };
    } catch (error: any) {
        console.error('Error fetching forms:', error);
        return { success: false, error: error.message };
    }
}

export async function getForm(formId: string): Promise<{ success: boolean; data?: FormSchema; error?: string }> {
    try {
        // Fetch form details
        const { data: form, error: formError } = await supabase
            .from('forms')
            .select('*')
            .eq('id', formId)
            .single();
        if (formError || !form) throw new Error('Form not found');

        // Fetch questions
        const { data: questionsData, error: questionsError } = await supabase
            .from('questions')
            .select('*')
            .eq('form_id', formId)
            .order('order', { ascending: true });
        if (questionsError) throw questionsError;

        // Map to FormSchema
        const questions: Question[] = (questionsData || []).map((q: any) => ({
            id: q.id,
            type: q.type,
            text: q.text,
            options: q.options || undefined,
            conditionalTextInputs: q.conditional_text_inputs || undefined
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
        const submissionId = randomUUID();
        const { error: formError } = await supabase
            .from('filled_forms')
            .insert([{ id: submissionId, form_id: formId }]);
        if (formError) throw formError;

        // 2. Save Answers
        const answersToInsert = Object.entries(answers).map(([questionId, value]) => ({
            id: randomUUID(),
            filled_form_id: submissionId,
            question_id: questionId,
            value
        }));
        
        if (answersToInsert.length > 0) {
            const { error: answersError } = await supabase
                .from('form_answers')
                .insert(answersToInsert);
            if (answersError) throw answersError;
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
        const formId = randomUUID();
        const { error: formError } = await supabase
            .from('forms')
            .insert([{ id: formId, title: formTitle, description: 'Global Screening Form' }]);
        if (formError) throw formError;

        // 2. Insert new questions
        if (questions.length > 0) {
            const questionsToInsert = questions.map((q, index) => ({
                id: randomUUID(),
                form_id: formId,
                text: q.text,
                type: q.type,
                options: q.options || null,
                conditional_text_inputs: q.conditionalTextInputs || null,
                order: index
            }));
            
            const { error: questionsError } = await supabase
                .from('questions')
                .insert(questionsToInsert);
            if (questionsError) throw questionsError;
        }

        // 3. Delete old forms if requested (after successfully creating the new one)
        if (deleteOldForms) {
            // Get all old screening forms (excluding the one we just created)
            const { data: oldForms, error: fetchError } = await supabase
                .from('forms')
                .select('id')
                .like('title', `${SCREENING_FORM_TITLE}%`)
                .neq('id', formId);
            
            if (!fetchError && oldForms && oldForms.length > 0) {
                // Delete old forms (cascade will delete their questions)
                const oldFormIds = oldForms.map(f => f.id);
                try {
                    const { error: deleteError } = await supabase
                        .from('forms')
                        .delete()
                        .in('id', oldFormIds);
                    if (deleteError) {
                        console.error('Error deleting old forms:', deleteError);
                        // Don't fail the whole operation if deletion fails
                    }
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
        const { data: forms, error: formsError } = await supabase
            .from('forms')
            .select('id, title, description, created_at')
            .like('title', `${SCREENING_FORM_TITLE}%`)
            .order('created_at', { ascending: false })
            .limit(1);

        if (formsError || !forms || forms.length === 0) {
            // No screening forms found, return null (not an error, just empty)
            return { success: true, data: null };
        }

        const form = forms[0];

        const { data: questions, error: questionsError } = await supabase
            .from('questions')
            .select('*')
            .eq('form_id', form.id)
            .order('order', { ascending: true });
        
        if (questionsError) throw questionsError;

        const schema: FormSchema = {
            id: form.id,
            title: SCREENING_FORM_TITLE, // Return the base title for display
            questions: (questions || []).map((q: any) => ({ // Explicit typing to fix implicit any
                id: q.id,
                type: q.type as QuestionType,
                text: q.text,
                options: q.options || undefined,
                conditionalTextInputs: q.conditional_text_inputs || undefined
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
                await supabase
                    .from('form_submissions')
                    .delete()
                    .eq('client_id', clientId)
                    .eq('form_id', formResult.data.id)
                    .eq('status', 'pending');
            } catch (deleteError) {
                console.error('Error deleting old pending submissions:', deleteError);
                // Don't fail the whole operation if deletion fails, but log it
            }
        }

        const submissionId = randomUUID();
        const token = randomUUID();
        const { error: insertError } = await supabase
            .from('form_submissions')
            .insert([{
                id: submissionId,
                form_id: formResult.data.id,
                client_id: clientId || null,
                token,
                status: 'pending',
                data
            }]);
        if (insertError) throw insertError;

        const submission = { id: submissionId, token, form_id: formResult.data.id, client_id: clientId || null, status: 'pending', data };

        // Set screening status to waiting_approval when form is submitted
        if (clientId) {
            try {
                await supabase
                    .from('clients')
                    .update({ screening_status: 'waiting_approval' })
                    .eq('id', clientId);
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
        const { data: submission, error: fetchError } = await supabase
            .from('form_submissions')
            .select('*')
            .eq('token', token)
            .single();

        if (fetchError || !submission) throw new Error('Submission not found');

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

        const payload: any = { status };
        if (signatureUrl) payload.signature_url = signatureUrl;
        if (comments) payload.comments = comments;
        
        const { error: updateError } = await supabase
            .from('form_submissions')
            .update(payload)
            .eq('token', token);
        if (updateError) throw updateError;

        // Get client_id from submission
        const { data: updatedSubmission } = await supabase
            .from('form_submissions')
            .select('client_id')
            .eq('token', token)
            .single();

        // Update client screening_status based on submission status
        if (updatedSubmission?.client_id) {
            const newScreeningStatus = status === 'accepted' ? 'approved' : 'rejected';
            try {
                await supabase
                    .from('clients')
                    .update({ screening_status: newScreeningStatus })
                    .eq('id', updatedSubmission.client_id);
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

        const { error: updateError } = await supabase
            .from('form_submissions')
            .update({ pdf_url: key })
            .eq('token', token);
        if (updateError) throw updateError;

        return { success: true, pdfUrl: key };
    } catch (error: any) {
        console.error('Error finalizing submission:', error);
        return { success: false, error: error.message };
    }
}

export async function getClientSubmissions(clientId: string) {
    try {
        const { data, error } = await supabase
            .from('form_submissions')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false });
        
        if (error) return { success: false, error: error.message };
        return { success: true, data: data || [] };
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
