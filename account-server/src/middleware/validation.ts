/**
 * Zod validation middleware.
 * Validates request body, query, or params against a Zod schema.
 */
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

type ValidationTarget = 'body' | 'query' | 'params';

/**
 * Create Express middleware that validates a request field against a Zod schema.
 * On failure, returns 400 with structured error details.
 */
export function validate(schema: ZodSchema, target: ValidationTarget = 'body') {
    return (req: Request, res: Response, next: NextFunction): void => {
        try {
            const parsed = schema.parse(req[target]);
            // Replace with parsed (coerced/defaulted) values
            (req as any)[target] = parsed;
            next();
        } catch (err) {
            if (err instanceof ZodError) {
                res.status(400).json({
                    error: 'Validation failed',
                    details: err.errors.map(e => ({
                        field: e.path.join('.'),
                        message: e.message,
                    })),
                });
                return;
            }
            next(err);
        }
    };
}
