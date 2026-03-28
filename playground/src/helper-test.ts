export function test(a: string, b: string) {
    a = 'Changed reactive';
    b = 'Changed non-reactive';

    console.log(a, b)
}