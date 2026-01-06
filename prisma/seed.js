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
  { name: 'Potato', startWeek: 1, endWeek: 52 },
  { name: 'Onion', startWeek: 1, endWeek: 52 },
  { name: 'Garlic', startWeek: 1, endWeek: 52 },
  { name: 'Carrot', startWeek: 1, endWeek: 52 },
  { name: 'Celery', startWeek: 1, endWeek: 52 },

  // Spring vegetables (weeks 13-24)
  { name: 'Asparagus', startWeek: 13, endWeek: 24 },
  { name: 'Artichoke', startWeek: 10, endWeek: 22 },
  { name: 'Pea', startWeek: 14, endWeek: 26 },
  { name: 'Spinach', startWeek: 10, endWeek: 22 },
  { name: 'Lettuce', startWeek: 12, endWeek: 44 },
  { name: 'Radish', startWeek: 12, endWeek: 24 },
  { name: 'Spring Onion', startWeek: 12, endWeek: 28 },
  { name: 'Leek', startWeek: 36, endWeek: 16 }, // Fall through Spring (wraps)

  // Summer vegetables (weeks 25-37)
  { name: 'Tomato', startWeek: 24, endWeek: 40 },
  { name: 'Zucchini', startWeek: 22, endWeek: 38 },
  { name: 'Eggplant', startWeek: 26, endWeek: 38 },
  { name: 'Pepper', startWeek: 24, endWeek: 40 },
  { name: 'Cucumber', startWeek: 22, endWeek: 36 },
  { name: 'Corn', startWeek: 26, endWeek: 38 },
  { name: 'Green Bean', startWeek: 24, endWeek: 38 },
  { name: 'Basil', startWeek: 22, endWeek: 38 },
  { name: 'Watermelon', startWeek: 26, endWeek: 36 },
  { name: 'Melon', startWeek: 26, endWeek: 36 },

  // Fall vegetables (weeks 38-50)
  { name: 'Pumpkin', startWeek: 36, endWeek: 48 },
  { name: 'Butternut Squash', startWeek: 36, endWeek: 50 },
  { name: 'Sweet Potato', startWeek: 36, endWeek: 50 },
  { name: 'Beet', startWeek: 24, endWeek: 46 },
  { name: 'Turnip', startWeek: 38, endWeek: 14 }, // Fall through Winter (wraps)
  { name: 'Parsnip', startWeek: 40, endWeek: 12 }, // Fall through Winter (wraps)
  { name: 'Brussels Sprout', startWeek: 38, endWeek: 6 }, // Fall through early Winter (wraps)
  { name: 'Apple', startWeek: 34, endWeek: 48 },
  { name: 'Pear', startWeek: 32, endWeek: 46 },
  { name: 'Grape', startWeek: 32, endWeek: 44 },

  // Winter vegetables (weeks 51-52, 1-12)
  { name: 'Cabbage', startWeek: 1, endWeek: 52 }, // Almost year-round but best in cool weather
  { name: 'Kale', startWeek: 38, endWeek: 14 }, // Fall through Winter (wraps)
  { name: 'Broccoli', startWeek: 38, endWeek: 20 }, // Fall through Spring (wraps)
  { name: 'Cauliflower', startWeek: 38, endWeek: 20 }, // Fall through Spring (wraps)
  { name: 'Chard', startWeek: 14, endWeek: 46 },
  { name: 'Endive', startWeek: 40, endWeek: 14 }, // Fall through Winter (wraps)
  { name: 'Fennel', startWeek: 38, endWeek: 14 }, // Fall through Winter (wraps)

  // Citrus (Winter - early Spring in Northern Hemisphere)
  { name: 'Orange', startWeek: 48, endWeek: 14 }, // Winter (wraps)
  { name: 'Lemon', startWeek: 48, endWeek: 18 }, // Winter through early Spring (wraps)
  { name: 'Grapefruit', startWeek: 48, endWeek: 14 }, // Winter (wraps)
  { name: 'Mandarin', startWeek: 46, endWeek: 10 }, // Winter (wraps)

  // Berries (Spring - Summer)
  { name: 'Strawberry', startWeek: 18, endWeek: 28 },
  { name: 'Blueberry', startWeek: 24, endWeek: 36 },
  { name: 'Raspberry', startWeek: 24, endWeek: 38 },
  { name: 'Blackberry', startWeek: 28, endWeek: 38 },

  // Other common produce
  { name: 'Mushroom', startWeek: 1, endWeek: 52 }, // Cultivated year-round
  { name: 'Avocado', startWeek: 1, endWeek: 52 }, // Imported year-round
  { name: 'Banana', startWeek: 1, endWeek: 52 }, // Imported year-round
];

async function main() {
  console.log('Seeding seasonal vegetables...');

  for (const veg of SEASONAL_VEGETABLES) {
    await prisma.seasonalVegetable.upsert({
      where: { name: veg.name },
      update: {
        startWeek: veg.startWeek,
        endWeek: veg.endWeek
      },
      create: veg
    });
  }

  console.log(`Seeded ${SEASONAL_VEGETABLES.length} vegetables`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
