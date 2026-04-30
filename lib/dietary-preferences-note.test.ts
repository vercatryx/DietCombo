/**
 * Run: npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' lib/dietary-preferences-note.test.ts
 */
import assert from 'assert';
import { mergeDietaryFlagsIntoNote, parseDietaryFlags } from './dietary-preferences-note';

function eq(actual: unknown, expected: unknown, msg?: string) {
    assert.deepStrictEqual(actual, expected, msg);
}

// --- parse ---
eq(parseDietaryFlags(''), { glutenFree: false, sugarFree: false, dairyFree: false });
eq(parseDietaryFlags('Gluten free please'), { glutenFree: true, sugarFree: false, dairyFree: false });
eq(parseDietaryFlags('gluten-free'), { glutenFree: true, sugarFree: false, dairyFree: false });
eq(parseDietaryFlags('No gluten'), { glutenFree: true, sugarFree: false, dairyFree: false });
eq(parseDietaryFlags('prefers GF meals'), { glutenFree: true, sugarFree: false, dairyFree: false });

eq(parseDietaryFlags('Sugar free'), { glutenFree: false, sugarFree: true, dairyFree: false });
eq(parseDietaryFlags('no sugar'), { glutenFree: false, sugarFree: true, dairyFree: false });

eq(parseDietaryFlags('dairy free'), { glutenFree: false, sugarFree: false, dairyFree: true });
eq(parseDietaryFlags('Dariy free'), { glutenFree: false, sugarFree: false, dairyFree: true });
eq(parseDietaryFlags('lactose-free diet'), { glutenFree: false, sugarFree: false, dairyFree: true });
eq(parseDietaryFlags('Allergic: nuts. Also milk free.'), { glutenFree: false, sugarFree: false, dairyFree: true });

eq(parseDietaryFlags('Gluten free, sugar free, no dairy'), {
    glutenFree: true,
    sugarFree: true,
    dairyFree: true
});

// unrelated prose preserved conceptually
const long =
    'Client likes spicy food. Needs gluten free and sugar free. Call before delivery.';
eq(parseDietaryFlags(long).glutenFree, true);
eq(parseDietaryFlags(long).sugarFree, true);

// --- merge: append ---
eq(
    mergeDietaryFlagsIntoNote('', { glutenFree: true, sugarFree: false, dairyFree: false }),
    'Gluten free'
);
eq(
    mergeDietaryFlagsIntoNote('Hello world', { glutenFree: true, sugarFree: false, dairyFree: false }),
    'Hello world, gluten free'
);
eq(
    mergeDietaryFlagsIntoNote('Already gluten free', { glutenFree: true, sugarFree: false, dairyFree: false }),
    'Already gluten free'
);

// --- merge: strip + unrelated text ---
const stripped = mergeDietaryFlagsIntoNote('Notes: no nuts. Gluten free.', {
    glutenFree: false,
    sugarFree: false,
    dairyFree: false
});
assert.ok(stripped.includes('no nuts'), 'should keep unrelated sentence');
assert.ok(!parseDietaryFlags(stripped).glutenFree, 'gluten should be off');

// --- merge: turn on second flag ---
const two = mergeDietaryFlagsIntoNote('Gluten free', {
    glutenFree: true,
    sugarFree: true,
    dairyFree: false
});
eq(parseDietaryFlags(two), { glutenFree: true, sugarFree: true, dairyFree: false });

console.log('dietary-preferences-note tests OK');
