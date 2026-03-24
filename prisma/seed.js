const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Seasonal vegetables data (Northern Hemisphere)
 * Week numbers: 1-52
 * For Southern Hemisphere, offset by 26 weeks
 *
 * Seasons reference (Northern Hemisphere):
 * - Spring: weeks 13-24 (late March - mid June)
 * - Summer: weeks 25-37 (late June - mid September)
 * - Fall: weeks 38-50 (late September - mid December)
 * - Winter: weeks 51-52, 1-12 (late December - mid March)
 */
const SEASONAL_VEGETABLES = [
  // Year-round vegetables (available all year)
  { name: 'Potato', nameEs: 'Papa', namePt: 'Batata', startWeek: 1, endWeek: 52 },
  { name: 'Onion', nameEs: 'Cebolla', namePt: 'Cebola', startWeek: 1, endWeek: 52 },
  { name: 'Garlic', nameEs: 'Ajo', namePt: 'Alho', startWeek: 1, endWeek: 52 },
  { name: 'Carrot', nameEs: 'Zanahoria', namePt: 'Cenoura', startWeek: 1, endWeek: 52 },
  { name: 'Celery', nameEs: 'Apio', namePt: 'Aipo', startWeek: 1, endWeek: 52 },

  // Spring vegetables (weeks 13-24)
  { name: 'Asparagus', nameEs: 'Espárrago', namePt: 'Aspargo', startWeek: 13, endWeek: 24 },
  { name: 'Artichoke', nameEs: 'Alcachofa', namePt: 'Alcachofra', startWeek: 10, endWeek: 22 },
  { name: 'Pea', nameEs: 'Arveja', namePt: 'Ervilha', startWeek: 14, endWeek: 26 },
  { name: 'Spinach', nameEs: 'Espinaca', namePt: 'Espinafre', startWeek: 10, endWeek: 22 },
  { name: 'Lettuce', nameEs: 'Lechuga', namePt: 'Alface', startWeek: 12, endWeek: 44 },
  { name: 'Radish', nameEs: 'Rábano', namePt: 'Rabanete', startWeek: 12, endWeek: 24 },
  { name: 'Spring Onion', nameEs: 'Cebollín', namePt: 'Cebolinha', startWeek: 12, endWeek: 28 },
  { name: 'Leek', nameEs: 'Puerro', namePt: 'Alho-poró', startWeek: 36, endWeek: 16 }, // Fall through Spring (wraps)

  // Summer vegetables (weeks 25-37)
  { name: 'Tomato', nameEs: 'Tomate', namePt: 'Tomate', startWeek: 24, endWeek: 40 },
  { name: 'Zucchini', nameEs: 'Calabacín', namePt: 'Abobrinha', startWeek: 22, endWeek: 38 },
  { name: 'Eggplant', nameEs: 'Berenjena', namePt: 'Berinjela', startWeek: 26, endWeek: 38 },
  { name: 'Pepper', nameEs: 'Pimiento', namePt: 'Pimentão', startWeek: 24, endWeek: 40 },
  { name: 'Cucumber', nameEs: 'Pepino', namePt: 'Pepino', startWeek: 22, endWeek: 36 },
  { name: 'Corn', nameEs: 'Maíz', namePt: 'Milho', startWeek: 26, endWeek: 38 },
  { name: 'Green Bean', nameEs: 'Judía verde', namePt: 'Vagem', startWeek: 24, endWeek: 38 },
  { name: 'Basil', nameEs: 'Albahaca', namePt: 'Manjericão', startWeek: 22, endWeek: 38 },

  // Fall vegetables (weeks 38-50)
  { name: 'Pumpkin', nameEs: 'Calabaza', namePt: 'Abóbora', startWeek: 36, endWeek: 48 },
  { name: 'Butternut Squash', nameEs: 'Calabaza butternut', namePt: 'Abóbora butternut', startWeek: 36, endWeek: 50 },
  { name: 'Sweet Potato', nameEs: 'Batata', namePt: 'Batata-doce', startWeek: 36, endWeek: 50 },
  { name: 'Beet', nameEs: 'Remolacha', namePt: 'Beterraba', startWeek: 24, endWeek: 46 },
  { name: 'Turnip', nameEs: 'Nabo', namePt: 'Nabo', startWeek: 38, endWeek: 14 }, // Fall through Winter (wraps)
  { name: 'Parsnip', nameEs: 'Chirivía', namePt: 'Pastinaga', startWeek: 40, endWeek: 12 }, // Fall through Winter (wraps)
  { name: 'Brussels Sprout', nameEs: 'Col de Bruselas', namePt: 'Couve-de-bruxelas', startWeek: 38, endWeek: 6 }, // Fall through early Winter (wraps)

  // Winter vegetables (weeks 51-52, 1-12)
  { name: 'Cabbage', nameEs: 'Repollo', namePt: 'Repolho', startWeek: 1, endWeek: 52 },
  { name: 'Kale', nameEs: 'Col rizada', namePt: 'Couve', startWeek: 38, endWeek: 14 }, // Fall through Winter (wraps)
  { name: 'Broccoli', nameEs: 'Brócoli', namePt: 'Brócolis', startWeek: 38, endWeek: 20 }, // Fall through Spring (wraps)
  { name: 'Cauliflower', nameEs: 'Coliflor', namePt: 'Couve-flor', startWeek: 38, endWeek: 20 }, // Fall through Spring (wraps)
  { name: 'Chard', nameEs: 'Acelga', namePt: 'Acelga', startWeek: 14, endWeek: 46 },
  { name: 'Endive', nameEs: 'Endivia', namePt: 'Endívia', startWeek: 40, endWeek: 14 }, // Fall through Winter (wraps)
  { name: 'Fennel', nameEs: 'Hinojo', namePt: 'Funcho', startWeek: 38, endWeek: 14 }, // Fall through Winter (wraps)

  // Other common produce
  { name: 'Mushroom', nameEs: 'Champiñón', namePt: 'Cogumelo', startWeek: 1, endWeek: 52 }, // Cultivated year-round
];

/**
 * Seasonal fruits data (Northern Hemisphere)
 */
const SEASONAL_FRUITS = [
  // Citrus (Winter - early Spring)
  { name: 'Orange', nameEs: 'Naranja', namePt: 'Laranja', startWeek: 48, endWeek: 14 },
  { name: 'Lemon', nameEs: 'Limón', namePt: 'Limão', startWeek: 48, endWeek: 18 },
  { name: 'Grapefruit', nameEs: 'Pomelo', namePt: 'Toranja', startWeek: 48, endWeek: 14 },
  { name: 'Mandarin', nameEs: 'Mandarina', namePt: 'Tangerina', startWeek: 46, endWeek: 10 },
  { name: 'Lime', nameEs: 'Lima', namePt: 'Lima', startWeek: 20, endWeek: 40 },

  // Berries (Spring - Summer)
  { name: 'Strawberry', nameEs: 'Fresa', namePt: 'Morango', startWeek: 18, endWeek: 28 },
  { name: 'Blueberry', nameEs: 'Arándano', namePt: 'Mirtilo', startWeek: 24, endWeek: 36 },
  { name: 'Raspberry', nameEs: 'Frambuesa', namePt: 'Framboesa', startWeek: 24, endWeek: 38 },
  { name: 'Blackberry', nameEs: 'Mora', namePt: 'Amora', startWeek: 28, endWeek: 38 },
  { name: 'Cherry', nameEs: 'Cereza', namePt: 'Cereja', startWeek: 20, endWeek: 28 },

  // Summer fruits
  { name: 'Watermelon', nameEs: 'Sandía', namePt: 'Melancia', startWeek: 26, endWeek: 36 },
  { name: 'Melon', nameEs: 'Melón', namePt: 'Melão', startWeek: 26, endWeek: 36 },
  { name: 'Peach', nameEs: 'Durazno', namePt: 'Pêssego', startWeek: 22, endWeek: 36 },
  { name: 'Nectarine', nameEs: 'Nectarina', namePt: 'Nectarina', startWeek: 24, endWeek: 36 },
  { name: 'Apricot', nameEs: 'Damasco', namePt: 'Damasco', startWeek: 20, endWeek: 30 },
  { name: 'Plum', nameEs: 'Ciruela', namePt: 'Ameixa', startWeek: 24, endWeek: 38 },
  { name: 'Fig', nameEs: 'Higo', namePt: 'Figo', startWeek: 30, endWeek: 42 },

  // Fall fruits
  { name: 'Apple', nameEs: 'Manzana', namePt: 'Maçã', startWeek: 34, endWeek: 48 },
  { name: 'Pear', nameEs: 'Pera', namePt: 'Pera', startWeek: 32, endWeek: 46 },
  { name: 'Grape', nameEs: 'Uva', namePt: 'Uva', startWeek: 32, endWeek: 44 },
  { name: 'Pomegranate', nameEs: 'Granada', namePt: 'Romã', startWeek: 38, endWeek: 48 },
  { name: 'Quince', nameEs: 'Membrillo', namePt: 'Marmelo', startWeek: 38, endWeek: 46 },
  { name: 'Persimmon', nameEs: 'Caqui', namePt: 'Caqui', startWeek: 40, endWeek: 50 },

  // Tropical / Year-round (imported)
  { name: 'Banana', nameEs: 'Banana', namePt: 'Banana', startWeek: 1, endWeek: 52 },
  { name: 'Avocado', nameEs: 'Palta', namePt: 'Abacate', startWeek: 1, endWeek: 52 },
  { name: 'Pineapple', nameEs: 'Ananá', namePt: 'Abacaxi', startWeek: 1, endWeek: 52 },
  { name: 'Mango', nameEs: 'Mango', namePt: 'Manga', startWeek: 18, endWeek: 36 },
  { name: 'Kiwi', nameEs: 'Kiwi', namePt: 'Kiwi', startWeek: 40, endWeek: 14 },
  { name: 'Coconut', nameEs: 'Coco', namePt: 'Coco', startWeek: 1, endWeek: 52 },
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
        endWeek: veg.endWeek
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
        endWeek: fruit.endWeek
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
