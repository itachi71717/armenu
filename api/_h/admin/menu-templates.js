// GET /api/admin/menu-templates -> { templates:[...] }
// Curated menu structures. Read-only, no DB access. Seeding is done client-side
// through the existing admin/categories and admin/dishes endpoints.
import { requireAdmin } from '../../_auth.js';

const it = (name, desc, price_hint) => ({ name, desc, price_hint });

const TEMPLATES = [
  {
    slug: 'steakhouse', name: 'Steakhouse', tagline: 'Cuts, sides, sauces',
    hero_photo_hint: 'Warm low-lit steak on cast iron',
    categories: [
      { name: 'Starters', tagline: 'To share', items: [
        it('Cast-iron cornbread', 'Skillet-baked, honey butter', 'R55'),
        it('Bone marrow', 'Roasted, parsley salad, grilled sourdough', 'R95'),
        it('Peppered beef carpaccio', 'Rocket, parmesan, lemon oil', 'R89') ] },
      { name: 'Mains — The Grill', tagline: 'Aged 21 days', items: [
        it('Ribeye 300g', 'Deep marbling, flame-grilled to your liking', 'R225'),
        it('Fillet 250g', 'Tender, lean, cut to order', 'R245'),
        it('Sirloin 350g', 'Grass-fed, rich beefy bite', 'R199'),
        it('Half rack of ribs', 'Slow-cooked, sticky glaze', 'R175') ] },
      { name: 'Sides', tagline: 'Make it yours', items: [
        it('Hand-cut chips', 'Skin-on, sea salt', 'R42'),
        it('Creamed spinach', 'Nutmeg, parmesan crust', 'R48'),
        it('Onion rings', 'Beer-battered, crisp', 'R45') ] },
      { name: 'Sauces', tagline: 'Your steak, your way', items: [
        it('Peppercorn', 'Brandy cream, cracked pepper', 'R25'),
        it('Chimichurri', 'Fresh herb, garlic, red wine vinegar', 'R25'),
        it('Mushroom', 'Wild mushroom, thyme cream', 'R25') ] },
      { name: 'Dessert', tagline: 'A sweet last word', items: [
        it('Malva pudding', 'Warm, apricot, vanilla custard', 'R65'),
        it('Chocolate fondant', 'Molten centre, salted caramel ice cream', 'R72') ] }
    ]
  },
  {
    slug: 'italian', name: 'Italian', tagline: 'Pasta, pizza, la dolce vita',
    hero_photo_hint: 'Steaming pasta twirled on a fork, basil and parmesan',
    categories: [
      { name: 'Antipasti', tagline: 'Share the table', items: [
        it('Burrata', 'Creamy centre, cherry tomato, basil oil', 'R98'),
        it('Focaccia', 'Rosemary, sea salt, whipped ricotta', 'R55'),
        it('Arancini', 'Crisp risotto balls, molten mozzarella', 'R68') ] },
      { name: 'Pasta', tagline: 'Made fresh every morning', items: [
        it('Spaghetti carbonara', 'Guanciale, egg yolk, pecorino', 'R129'),
        it('Tagliatelle ragu', 'Eight-hour beef and pork ragu', 'R139'),
        it('Penne arrabbiata', 'Chilli, garlic, San Marzano tomato', 'R109') ] },
      { name: 'Pizza', tagline: 'Wood-fired, 48-hour dough', items: [
        it('Margherita', 'Fior di latte, basil, olive oil', 'R99'),
        it('Diavola', 'Spicy salami, chilli honey', 'R125'),
        it('Prosciutto e rucola', 'Parma ham, rocket, shaved parmesan', 'R135') ] },
      { name: 'Contorni', tagline: 'On the side', items: [
        it('Rocket and parmesan salad', 'Lemon, balsamic', 'R55'),
        it('Roast potatoes', 'Rosemary, garlic', 'R45') ] },
      { name: 'Dolci', tagline: 'La dolce vita', items: [
        it('Tiramisu', 'Espresso-soaked savoiardi, mascarpone', 'R69'),
        it('Panna cotta', 'Vanilla bean, berry compote', 'R62'),
        it('Affogato', 'Gelato drowned in hot espresso', 'R48') ] }
    ]
  },
  {
    slug: 'cafe', name: 'Cafe', tagline: 'Brunch, bakes and good coffee',
    hero_photo_hint: 'Sunlit table, flat white and avocado toast',
    categories: [
      { name: 'Breakfast', tagline: 'Served until 11', items: [
        it('Eggs Benedict', 'Poached eggs, ham, hollandaise on sourdough', 'R89'),
        it('Avocado smash', 'Feta, chilli flakes, poached egg', 'R79'),
        it('Full English', 'Bacon, sausage, eggs, beans, toast', 'R105') ] },
      { name: 'Lunch', tagline: 'Fresh and filling', items: [
        it('Chicken mayo croissant', 'Free-range chicken, butter lettuce', 'R79'),
        it('Halloumi salad', 'Grilled halloumi, roast veg, honey mustard', 'R85'),
        it('Gourmet toasted sandwich', 'Cheddar, tomato, chutney', 'R69') ] },
      { name: 'Bakes & Sweets', tagline: 'Baked this morning', items: [
        it('Blueberry muffin', 'Buttermilk, streusel top', 'R38'),
        it('Carrot cake', 'Cream cheese icing, walnuts', 'R52'),
        it('Almond croissant', 'Twice-baked, frangipane', 'R44') ] },
      { name: 'Coffee & Tea', tagline: 'Roasted locally', items: [
        it('Flat white', 'Double shot, silky milk', 'R36'),
        it('Cappuccino', 'Classic, cocoa dust', 'R34'),
        it('Rooibos latte', 'Steamed milk, honey', 'R38') ] },
      { name: 'Cold Drinks', tagline: 'Cool down', items: [
        it('Fresh orange juice', 'Squeezed to order', 'R42'),
        it('Iced coffee', 'Cold-brew, vanilla, milk', 'R46') ] }
    ]
  },
  {
    slug: 'pub', name: 'Pub', tagline: 'Burgers, pints and bar snacks',
    hero_photo_hint: 'Burger and golden pint on a dark wood bar',
    categories: [
      { name: 'Bar Snacks', tagline: 'Best with a cold one', items: [
        it('Loaded nachos', 'Cheese, jalapeno, guacamole, sour cream', 'R89'),
        it('Buffalo wings', 'Hot sauce, blue cheese dip', 'R85'),
        it('Biltong and droewors board', 'House-cured, pickles, mustard', 'R95') ] },
      { name: 'Burgers', tagline: 'Smashed to order', items: [
        it('The Pub Burger', 'Double patty, cheddar, pickles, house sauce', 'R135'),
        it('Crispy chicken burger', 'Buttermilk fried, slaw, sriracha mayo', 'R119'),
        it('Veggie burger', 'Black bean patty, avocado, chipotle mayo', 'R109') ] },
      { name: 'From the Kitchen', tagline: 'Proper pub grub', items: [
        it('Fish and chips', 'Beer-battered hake, mushy peas, tartare', 'R125'),
        it('Bangers and mash', 'Pork sausages, onion gravy', 'R115'),
        it('Ribs and wings combo', 'Half rack and six wings', 'R185') ] },
      { name: 'Sides', tagline: 'Add to any meal', items: [
        it('Chips', 'Crispy, salted', 'R40'),
        it('Sweet potato fries', 'Paprika salt', 'R48'),
        it('Coleslaw', 'Creamy, crunchy', 'R32') ] },
      { name: 'Drinks & Desserts', tagline: 'Finish on a high', items: [
        it('Craft lager pint', 'Local brew, ice cold', 'R48'),
        it('Sticky toffee pudding', 'Toffee sauce, vanilla ice cream', 'R62') ] }
    ]
  }
];

export default async function handler(req, res) {
  if (!requireAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();
  return res.status(200).json({ templates: TEMPLATES });
}
