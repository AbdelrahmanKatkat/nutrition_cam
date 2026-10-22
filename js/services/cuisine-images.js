/**
 * Photos for the "Top Cuisines" strip. Each cuisine maps to a dish name, and the photo comes from
 * Wikipedia through the same title-matched lookup as NutriChef (services/photo.js).
 *
 * @module services/cuisine-images
 */

import { findDishPhoto } from './photo.js';

/** cuisine key -> dish name to search for. Unlisted cuisines get no photo and a letter tile. */
const DISH = {
  pizza: 'Pizza',
  sushi: 'Sushi',
  burger: 'Hamburger',
  mexican: 'Taco',
  indian: 'Indian cuisine',
  italian: 'Pasta',
  chinese: 'Chinese cuisine',
  thai: 'Thai cuisine',
  japanese: 'Japanese cuisine',
  american: 'American cuisine',
  mediterranean: 'Mediterranean cuisine',
  lebanese: 'Lebanese cuisine',
  turkish: 'Turkish cuisine',
  greek: 'Greek cuisine',
  french: 'French cuisine',
  korean: 'Korean cuisine',
  vietnamese: 'Vietnamese cuisine',
  ethiopian: 'Ethiopian cuisine',
  coffee_shop: 'Coffee',
  cafe: 'Coffee',
  fast_food: 'Fast food',
  seafood: 'Seafood',
  steak_house: 'Steak',
  kebab: 'Kebab',
  falafel: 'Falafel',
};

const cache = new Map(); // cuisine key -> photo | null (null = looked up, nothing found)

/**
 * @param {string} key  cuisine key, e.g. 'pizza'
 * @returns {Promise<{url:string, title:string, pageUrl:string}|null>}
 */
export async function getCuisinePhoto(key) {
  if (cache.has(key)) return cache.get(key);
  const dish = DISH[key];
  const photo = dish ? await findDishPhoto(dish) : null;
  cache.set(key, photo);
  return photo;
}

/** Whether a cuisine has a photo mapping at all (so the page can skip the lookup for others). */
export const hasCuisinePhoto = (key) => Boolean(DISH[key]);
