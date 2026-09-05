import { unknown } from "zod";

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

export function parseJSON(json: string): unknown | Error {
    try {
        return JSON.parse(json) as unknown;
    } catch (error) {
        return error as Error;
    }
}
