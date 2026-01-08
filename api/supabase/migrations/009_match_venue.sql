alter table matches add column if not exists venue_name text;
alter table matches add column if not exists venue_city text;
alter table matches add column if not exists venue_lat double precision;
alter table matches add column if not exists venue_lon double precision;
