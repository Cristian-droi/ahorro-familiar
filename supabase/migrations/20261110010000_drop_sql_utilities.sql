-- S6 T2: profits are computed in utilidades/domain (RN-6, ADR-001) and served
-- by GET /api/utilidades. The SQL versions rounded money in the database (S4 F12)
-- and counted contributions of every year; nothing calls them any more.

drop function public.get_my_utilities_by_year(integer);
drop function public.get_user_utilities_by_year(uuid, integer);
drop function public.get_all_users_utilities_by_year(integer);
