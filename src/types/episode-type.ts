import { createEnum } from '../utils/create-enum';

const episodeTypeValues = createEnum(['available', 'vip', 'svip', 'preview', 'locked', 'teaser', 'express'] as const);

export const EpisodeType = episodeTypeValues.object;

export type EpisodeType = typeof episodeTypeValues.type;

export const EpisodeTypeSchema = episodeTypeValues.schema;

export const EpisodeTypeValues = episodeTypeValues.values;
