export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function withTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
    return Promise.race([
        promise,
        sleep(ms).then(() => { throw new Error('timeout'); })
    ]);
}
