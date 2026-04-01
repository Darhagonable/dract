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
create_test_suite('./component/renamed-props');
create_test_suite('./component/bind-renamed-prop');
create_test_suite('./component/composition');

// --- Reactivity tests ---
create_test_suite('./reactivity/state-basic-counter');
create_test_suite('./reactivity/derived-basic');
create_test_suite('./reactivity/effect-watch');
create_test_suite('./reactivity/bind-proxy-property');
create_test_suite('./reactivity/bind-function');

// --- Component tests (bind) ---
create_test_suite('./component/bind-proxy-member');

// --- Control flow tests ---
create_test_suite('./control-flow/if');
create_test_suite('./control-flow/if-else');
create_test_suite('./control-flow/else-if');
create_test_suite('./control-flow/for-basic');
create_test_suite('./control-flow/switch-basic');
create_test_suite('./control-flow/try-catch');
create_test_suite('./control-flow/try-pending-catch');

// --- Lifecycle tests ---
create_test_suite('./lifecycle/onmount');
