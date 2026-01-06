export type QuestionType = 'text' | 'select';

export interface Question {
    id: string;
    type: QuestionType;
    text: string;
    options?: string[]; // Only for 'select' type
    conditionalTextInputs?: { [option: string]: boolean }; // Maps option text to whether it requires conditional text input
}

export interface FormSchema {
    id: string;
    title: string;
    questions: Question[];
}

export interface Answer {
    questionId: string;
    value: string;
}

export interface FilledForm {
    formId: string;
    answers: Answer[];
    submittedAt: string;
}
