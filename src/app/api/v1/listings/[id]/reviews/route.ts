import * as h from '@/server/api/handlers';
import { methodNotAllowed } from '@/server/api/http';

export const dynamic = 'force-dynamic';

export const GET = h.getListingReviews;
export const PUT = h.putListingReviews;
export const { POST, PATCH, DELETE } = methodNotAllowed('GET', 'PUT');
