/**
 * Main test runner for runtime tests.
 *
 * Tests are organized by category matching the docs structure:
 * - component/     -> component definition, props, composition
 * - reactivity/    -> state, derived, effect
 * - control-flow/  -> if, for
 * - lifecycle/     -> onMount, tick
 */

import { create_test_suite } from './test';

// --- Component tests ---
create_test_suite('./component/basic');
create_test_suite('./component/props');
create_test_suite('./component/composition');

// --- Reactivity tests ---
create_test_suite('./reactivity/state-basic-counter');
create_test_suite('./reactivity/derived-basic');
create_test_suite('./reactivity/effect-watch');

// --- Control flow tests ---
create_test_suite('./control-flow/if');
create_test_suite('./control-flow/if-else');
create_test_suite('./control-flow/for-basic');

// --- Lifecycle tests ---
create_test_suite('./lifecycle/onmount');
