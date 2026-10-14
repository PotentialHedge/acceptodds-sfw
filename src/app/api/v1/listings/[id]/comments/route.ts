import * as h from '@/server/api/handlers';
import { methodNotAllowed } from '@/server/api/http';

export const dynamic = 'force-dynamic';

export const GET = h.getPaperComments;
export const POST = h.postListingComment;
export const { PUT, PATCH, DELETE } = methodNotAllowed('GET', 'POST');
