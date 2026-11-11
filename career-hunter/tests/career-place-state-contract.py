# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Hold the state a job's location is filed under to what the location states. A spelled-out state was taken from the first state name found anywhere in the text, in a fixed order, so the capital was filed under Washington State, West Virginia under Virginia, and a city or street named after another state under that state. Every place here is one the published job list held on 2026-11-10.
"""The state a location is filed under: the engine's own lookup, with no store and no network."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
from jobhunter import geo


class StateOfAPlace(unittest.TestCase):
    def filed(self, cases):
        for location, state in cases:
            with self.subTest(location=location):
                self.assertEqual(geo.state_of(location), state)

    def test_a_two_letter_state_code_still_decides(self):
        self.filed([('Herndon, VA', 'VA'), ('USA-VA-Fort Belvoir', 'VA'), ('USA-DC-Washington', 'DC'), ('Washington, DC', 'DC'),
                    ('Kansas City, MO', 'MO')])

    def test_the_capital_is_the_district_however_it_is_written(self):
        self.filed([('Washington, D.C.', 'DC'), ('Washington D.C.', 'DC'),
                    ('Washington, District of Columbia, United States', 'DC'),
                    ('Washington, District of Columbia Metro Area', 'DC'),
                    ('All, District of Columbia', 'DC'), ('Remote, District of Columbia', 'DC')])

    def test_washington_state_stays_washington_state(self):
        self.filed([('Seattle, Washington', 'WA'), ('Redmond, Washington, United States', 'WA'), ('Washington', 'WA'),
                    ('Remote - Washington', 'WA')])

    def test_dc_after_another_city_is_not_the_district(self):
        self.filed([('Bogota, D.C., Colombia', None)])

    def test_west_virginia_is_not_virginia(self):
        self.filed([('Morgantown, West Virginia', 'WV'), ('Charleston, West Virginia, United States', 'WV'),
                    ('Remote - West Virginia', 'WV'), ('Richmond, Virginia', 'VA')])

    def test_a_city_named_after_another_state_is_filed_under_its_own(self):
        self.filed([('Kansas City, Missouri', 'MO'), ('Kansas City, Kansas', 'KS'), ('Delaware, Ohio', 'OH'),
                    ('Missouri City, Texas', 'TX'), ('California, Maryland', 'MD'), ('Maryland Heights, Missouri', 'MO'),
                    ('Arkansas City, Kansas', 'KS'), ('Indiana, Pennsylvania', 'PA'), ('Nevada, Missouri', 'MO')])

    def test_a_street_named_after_another_state_does_not_move_the_job(self):
        self.filed([('2401 Utah Ave S #800, Seattle, Washington, United States', 'WA'),
                    ('Chicago, Illinois, USA (444 N. Michigan Ave. - Coach)', 'IL')])

    def test_a_place_that_opens_with_the_country_reads_state_then_city(self):
        self.filed([('US, Missouri, Nevada', 'MO')])

    def test_a_text_that_lists_several_places_is_filed_under_the_first(self):
        self.filed([('New York, New York / Glendale, California', 'NY'), ('Vancouver, Washington; Portland, Oregon', 'WA'),
                    ('Portland, Oregon | Austin, Texas', 'OR')])

    def test_a_text_that_names_no_state_has_none(self):
        self.filed([('London, United Kingdom', None), ('Multiple Locations', None), ('United States', None), ('Remote', None),
                    ('', None), (None, None)])


if __name__ == '__main__':
    unittest.main()
