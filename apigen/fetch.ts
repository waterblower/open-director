export async function safeFetch(
    url: string,
    options?: RequestInit,
): Promise<Response | Error> {
    try {
        const response = await fetch(url, options);
        return response;
    } catch (error) {
        return error as Error;
    }
}
