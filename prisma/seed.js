const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Seasonal vegetables data with dual hemisphere support
 * Week numbers: 1-52
 * startWeek/endWeek = Northern Hemisphere (Europe/North America)
 * startWeekSouth/endWeekSouth = Southern Hemisphere (Argentina/South America)
 *
 * Northern Hemisphere seasons:
 * - Spring: weeks 13-24 (late March - mid June)
 * - Summer: weeks 25-37 (late June - mid September)
 * - Fall: weeks 38-50 (late September - mid December)
 * - Winter: weeks 51-52, 1-12 (late December - mid March)
 *
 * Southern Hemisphere seasons (Argentina):
 * - Spring: weeks 38-50 (late September - mid December)
 * - Summer: weeks 51-52, 1-12 (late December - mid March)
 * - Fall: weeks 13-24 (late March - mid June)
 * - Winter: weeks 25-37 (late June - mid September)
 */
const SEASONAL_VEGETABLES = [
  // Year-round vegetables
  { name: 'Potato', nameEs: 'Papa', namePt: 'Batata', startWeek: 1, endWeek: 52, startWeekSouth: 1, endWeekSouth: 52 },
  { name: 'Onion', nameEs: 'Cebolla', namePt: 'Cebola', startWeek: 1, endWeek: 52, startWeekSouth: 1, endWeekSouth: 52 },
  { name: 'Garlic', nameEs: 'Ajo', namePt: 'Alho', startWeek: 1, endWeek: 52, startWeekSouth: 1, endWeekSouth: 52 },
  { name: 'Carrot', nameEs: 'Zanahoria', namePt: 'Cenoura', startWeek: 1, endWeek: 52, startWeekSouth: 1, endWeekSouth: 52 },
  { name: 'Celery', nameEs: 'Apio', namePt: 'Aipo', startWeek: 1, endWeek: 52, startWeekSouth: 13, endWeekSouth: 44 },

  // Spring vegetables (North) / Fall vegetables (South - Argentina)
  { name: 'Asparagus', nameEs: 'Espárrago', namePt: 'Aspargo', startWeek: 13, endWeek: 24, startWeekSouth: 38, endWeekSouth: 48 },
  { name: 'Artichoke', nameEs: 'Alcachofa', namePt: 'Alcachofra', startWeek: 10, endWeek: 22, startWeekSouth: 13, endWeekSouth: 30 },
  { name: 'Pea', nameEs: 'Arveja', namePt: 'Ervilha', startWeek: 14, endWeek: 26, startWeekSouth: 38, endWeekSouth: 48 },
  { name: 'Spinach', nameEs: 'Espinaca', namePt: 'Espinafre', startWeek: 10, endWeek: 22, startWeekSouth: 13, endWeekSouth: 38 },
  { name: 'Lettuce', nameEs: 'Lechuga', namePt: 'Alface', startWeek: 12, endWeek: 44, startWeekSouth: 1, endWeekSouth: 52 },
  { name: 'Radish', nameEs: 'Rábano', namePt: 'Rabanete', startWeek: 12, endWeek: 24, startWeekSouth: 13, endWeekSouth: 38 },
  { name: 'Spring Onion', nameEs: 'Cebollín', namePt: 'Cebolinha', startWeek: 12, endWeek: 28, startWeekSouth: 38, endWeekSouth: 4 },
  { name: 'Leek', nameEs: 'Puerro', namePt: 'Alho-poró', startWeek: 36, endWeek: 16, startWeekSouth: 13, endWeekSouth: 38 },

  // Summer vegetables (North) / Summer vegetables (South - Argentina Dec-Mar)
  { name: 'Tomato', nameEs: 'Tomate', namePt: 'Tomate', startWeek: 24, endWeek: 40, startWeekSouth: 48, endWeekSouth: 14 },
  { name: 'Zucchini', nameEs: 'Calabacín', namePt: 'Abobrinha', startWeek: 22, endWeek: 38, startWeekSouth: 48, endWeekSouth: 12 },
  { name: 'Eggplant', nameEs: 'Berenjena', namePt: 'Berinjela', startWeek: 26, endWeek: 38, startWeekSouth: 48, endWeekSouth: 14 },
  { name: 'Pepper', nameEs: 'Pimiento', namePt: 'Pimentão', startWeek: 24, endWeek: 40, startWeekSouth: 48, endWeekSouth: 14 },
  { name: 'Cucumber', nameEs: 'Pepino', namePt: 'Pepino', startWeek: 22, endWeek: 36, startWeekSouth: 48, endWeekSouth: 10 },
  { name: 'Corn', nameEs: 'Maíz', namePt: 'Milho', startWeek: 26, endWeek: 38, startWeekSouth: 52, endWeekSouth: 12 },
  { name: 'Green Bean', nameEs: 'Judía verde', namePt: 'Vagem', startWeek: 24, endWeek: 38, startWeekSouth: 48, endWeekSouth: 10 },
  { name: 'Basil', nameEs: 'Albahaca', namePt: 'Manjericão', startWeek: 22, endWeek: 38, startWeekSouth: 44, endWeekSouth: 14 },

  // Fall vegetables (North) / Fall-Winter vegetables (South - Argentina Mar-Aug)
  { name: 'Pumpkin', nameEs: 'Calabaza', namePt: 'Abóbora', startWeek: 36, endWeek: 48, startWeekSouth: 10, endWeekSouth: 30 },
  { name: 'Butternut Squash', nameEs: 'Calabaza butternut', namePt: 'Abóbora butternut', startWeek: 36, endWeek: 50, startWeekSouth: 10, endWeekSouth: 30 },
  { name: 'Sweet Potato', nameEs: 'Batata', namePt: 'Batata-doce', startWeek: 36, endWeek: 50, startWeekSouth: 10, endWeekSouth: 24 },
  { name: 'Beet', nameEs: 'Remolacha', namePt: 'Beterraba', startWeek: 24, endWeek: 46, startWeekSouth: 1, endWeekSouth: 52 },
  { name: 'Turnip', nameEs: 'Nabo', namePt: 'Nabo', startWeek: 38, endWeek: 14, startWeekSouth: 14, endWeekSouth: 36 },
  { name: 'Parsnip', nameEs: 'Chirivía', namePt: 'Pastinaga', startWeek: 40, endWeek: 12, startWeekSouth: 14, endWeekSouth: 36 },
  { name: 'Brussels Sprout', nameEs: 'Col de Bruselas', namePt: 'Couve-de-bruxelas', startWeek: 38, endWeek: 6, startWeekSouth: 18, endWeekSouth: 32 },

  // Winter vegetables (North) / Winter vegetables (South - Argentina Jun-Sep)
  { name: 'Cabbage', nameEs: 'Repollo', namePt: 'Repolho', startWeek: 1, endWeek: 52, startWeekSouth: 1, endWeekSouth: 52 },
  { name: 'Kale', nameEs: 'Col rizada', namePt: 'Couve', startWeek: 38, endWeek: 14, startWeekSouth: 18, endWeekSouth: 36 },
  { name: 'Broccoli', nameEs: 'Brócoli', namePt: 'Brócolis', startWeek: 38, endWeek: 20, startWeekSouth: 14, endWeekSouth: 40 },
  { name: 'Cauliflower', nameEs: 'Coliflor', namePt: 'Couve-flor', startWeek: 38, endWeek: 20, startWeekSouth: 14, endWeekSouth: 40 },
  { name: 'Chard', nameEs: 'Acelga', namePt: 'Acelga', startWeek: 14, endWeek: 46, startWeekSouth: 1, endWeekSouth: 52 },
  { name: 'Endive', nameEs: 'Endivia', namePt: 'Endívia', startWeek: 40, endWeek: 14, startWeekSouth: 18, endWeekSouth: 36 },
  { name: 'Fennel', nameEs: 'Hinojo', namePt: 'Funcho', startWeek: 38, endWeek: 14, startWeekSouth: 14, endWeekSouth: 36 },

  // Other
  { name: 'Mushroom', nameEs: 'Champiñón', namePt: 'Cogumelo', startWeek: 1, endWeek: 52, startWeekSouth: 1, endWeekSouth: 52 },
];

/**
 * Seasonal fruits data with dual hemisphere support
 */
const SEASONAL_FRUITS = [
  // Citrus — South data from SENASA/Mercado Central (Argentina)
  // Orange: Navel Apr-Nov, Valencia Oct-Jan → combined Apr-Nov
  { name: 'Orange', nameEs: 'Naranja', namePt: 'Laranja', startWeek: 48, endWeek: 14, startWeekSouth: 14, endWeekSouth: 48 },
  // Lemon: Tucumán Mar-Sep (peak)
  { name: 'Lemon', nameEs: 'Limón', namePt: 'Limão', startWeek: 48, endWeek: 18, startWeekSouth: 10, endWeekSouth: 39 },
  // Grapefruit: Mar-Sep
  { name: 'Grapefruit', nameEs: 'Pomelo', namePt: 'Toranja', startWeek: 48, endWeek: 14, startWeekSouth: 10, endWeekSouth: 39 },
  // Mandarin: Apr-Sep
  { name: 'Mandarin', nameEs: 'Mandarina', namePt: 'Tangerina', startWeek: 46, endWeek: 10, startWeekSouth: 14, endWeekSouth: 39 },
  // Lime: May-Sep
  { name: 'Lime', nameEs: 'Lima', namePt: 'Lima', startWeek: 20, endWeek: 40, startWeekSouth: 19, endWeekSouth: 39 },

  // Berries — South data from INTA/Mercado Central
  // Strawberry: Sep-Mar (open field)
  { name: 'Strawberry', nameEs: 'Frutilla', namePt: 'Morango', startWeek: 18, endWeek: 28, startWeekSouth: 36, endWeekSouth: 13 },
  // Blueberry: Sep-Dec (Argentine export season)
  { name: 'Blueberry', nameEs: 'Arándano', namePt: 'Mirtilo', startWeek: 24, endWeek: 36, startWeekSouth: 36, endWeekSouth: 52 },
  // Raspberry: Nov-Apr
  { name: 'Raspberry', nameEs: 'Frambuesa', namePt: 'Framboesa', startWeek: 24, endWeek: 38, startWeekSouth: 45, endWeekSouth: 18 },
  // Blackberry: Nov-Jan
  { name: 'Blackberry', nameEs: 'Mora', namePt: 'Amora', startWeek: 28, endWeek: 38, startWeekSouth: 45, endWeekSouth: 4 },
  // Cherry: Nov-Jan (Patagonia)
  { name: 'Cherry', nameEs: 'Cereza', namePt: 'Cereja', startWeek: 20, endWeek: 28, startWeekSouth: 45, endWeekSouth: 4 },

  // Summer stone/vine fruits — South data from Mercado Central
  // Watermelon: Nov-Mar
  { name: 'Watermelon', nameEs: 'Sandía', namePt: 'Melancia', startWeek: 26, endWeek: 36, startWeekSouth: 45, endWeekSouth: 13 },
  // Melon: Nov-Mar
  { name: 'Melon', nameEs: 'Melón', namePt: 'Melão', startWeek: 26, endWeek: 36, startWeekSouth: 45, endWeekSouth: 13 },
  // Peach: Nov-Mar (peak Dec-Feb)
  { name: 'Peach', nameEs: 'Durazno', namePt: 'Pêssego', startWeek: 22, endWeek: 36, startWeekSouth: 45, endWeekSouth: 13 },
  // Nectarine: Nov-Feb
  { name: 'Nectarine', nameEs: 'Nectarina', namePt: 'Nectarina', startWeek: 24, endWeek: 36, startWeekSouth: 45, endWeekSouth: 9 },
  // Apricot: Dec-Feb (short season)
  { name: 'Apricot', nameEs: 'Damasco', namePt: 'Damasco', startWeek: 20, endWeek: 30, startWeekSouth: 49, endWeekSouth: 9 },
  // Plum: Dec-Mar
  { name: 'Plum', nameEs: 'Ciruela', namePt: 'Ameixa', startWeek: 24, endWeek: 38, startWeekSouth: 49, endWeekSouth: 13 },
  // Fig: Dec-Mar (peak Jan-Feb)
  { name: 'Fig', nameEs: 'Higo', namePt: 'Figo', startWeek: 30, endWeek: 42, startWeekSouth: 49, endWeekSouth: 13 },

  // Fall/storage fruits — South data from SENASA harvest calendar
  // Apple: Feb-Jun (fresh harvest, cold storage extends further)
  { name: 'Apple', nameEs: 'Manzana', namePt: 'Maçã', startWeek: 34, endWeek: 48, startWeekSouth: 5, endWeekSouth: 26 },
  // Pear: Jan-Jun
  { name: 'Pear', nameEs: 'Pera', namePt: 'Pera', startWeek: 32, endWeek: 46, startWeekSouth: 1, endWeekSouth: 26 },
  // Grape: Feb-Apr (table grapes)
  { name: 'Grape', nameEs: 'Uva', namePt: 'Uva', startWeek: 32, endWeek: 44, startWeekSouth: 5, endWeekSouth: 18 },
  // Pomegranate: Feb-May (San Juan/Salta)
  { name: 'Pomegranate', nameEs: 'Granada', namePt: 'Romã', startWeek: 38, endWeek: 48, startWeekSouth: 5, endWeekSouth: 22 },
  // Quince: Mar-Jun
  { name: 'Quince', nameEs: 'Membrillo', namePt: 'Marmelo', startWeek: 38, endWeek: 46, startWeekSouth: 10, endWeekSouth: 26 },
  // Persimmon: Apr-Jun (Mercado Central)
  { name: 'Persimmon', nameEs: 'Caqui', namePt: 'Caqui', startWeek: 40, endWeek: 50, startWeekSouth: 14, endWeekSouth: 26 },

  // Tropical / imported
  // Banana: year-round (Misiones + imports)
  { name: 'Banana', nameEs: 'Banana', namePt: 'Banana', startWeek: 1, endWeek: 52, startWeekSouth: 1, endWeekSouth: 52 },
  // Avocado/Palta: Apr-Sep (domestic from NOA)
  { name: 'Avocado', nameEs: 'Palta', namePt: 'Abacate', startWeek: 1, endWeek: 52, startWeekSouth: 14, endWeekSouth: 39 },
  // Pineapple: Dec-Mar domestic (Misiones), imported year-round
  { name: 'Pineapple', nameEs: 'Ananá', namePt: 'Abacaxi', startWeek: 1, endWeek: 52, startWeekSouth: 49, endWeekSouth: 13 },
  // Mango: Dec-Mar (Salta/Jujuy)
  { name: 'Mango', nameEs: 'Mango', namePt: 'Manga', startWeek: 18, endWeek: 36, startWeekSouth: 49, endWeekSouth: 13 },
  // Kiwi: Mar-Jun (fresh harvest), cold storage to Aug
  { name: 'Kiwi', nameEs: 'Kiwi', namePt: 'Kiwi', startWeek: 40, endWeek: 14, startWeekSouth: 10, endWeekSouth: 26 },
  // Coconut: year-round (imported from Brazil)
  { name: 'Coconut', nameEs: 'Coco', namePt: 'Coco', startWeek: 1, endWeek: 52, startWeekSouth: 1, endWeekSouth: 52 },
];

async function main() {
  console.log('Seeding seasonal vegetables...');

  for (const veg of SEASONAL_VEGETABLES) {
    await prisma.seasonalVegetable.upsert({
      where: { name: veg.name },
      update: {
        nameEs: veg.nameEs,
        namePt: veg.namePt,
        startWeek: veg.startWeek,
        endWeek: veg.endWeek,
        startWeekSouth: veg.startWeekSouth,
        endWeekSouth: veg.endWeekSouth
      },
      create: veg
    });
  }

  // Delete fruits that were previously in the vegetables table
  const fruitNames = SEASONAL_FRUITS.map(f => f.name);
  await prisma.seasonalVegetable.deleteMany({
    where: { name: { in: fruitNames } }
  });

  console.log(`Seeded ${SEASONAL_VEGETABLES.length} vegetables`);

  console.log('Seeding seasonal fruits...');

  for (const fruit of SEASONAL_FRUITS) {
    await prisma.seasonalFruit.upsert({
      where: { name: fruit.name },
      update: {
        nameEs: fruit.nameEs,
        namePt: fruit.namePt,
        startWeek: fruit.startWeek,
        endWeek: fruit.endWeek,
        startWeekSouth: fruit.startWeekSouth,
        endWeekSouth: fruit.endWeekSouth
      },
      create: fruit
    });
  }

  console.log(`Seeded ${SEASONAL_FRUITS.length} fruits`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
