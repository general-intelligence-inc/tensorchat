cmake_minimum_required(VERSION 3.13)

project(reactnativephonemis)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(PHONEMIS_ROOT ../../../../vendor/phonemis)

add_library(
  reactnativephonemis
  SHARED
  PhonemisBridge.cpp
  ${PHONEMIS_ROOT}/src/lexicon.cpp
  ${PHONEMIS_ROOT}/src/num2word.cpp
  ${PHONEMIS_ROOT}/src/phonemizer.cpp
  ${PHONEMIS_ROOT}/src/pipeline.cpp
  ${PHONEMIS_ROOT}/src/stress.cpp
  ${PHONEMIS_ROOT}/src/tagger.cpp
  ${PHONEMIS_ROOT}/src/tokenize.cpp
  ${PHONEMIS_ROOT}/src/tools.cpp
)

target_include_directories(
  reactnativephonemis
  PRIVATE
  ${PHONEMIS_ROOT}/include
)

target_compile_options(
  reactnativephonemis
  PRIVATE
  -fexceptions
  -frtti
)

find_library(log-lib log)

target_link_libraries(
  reactnativephonemis
  ${log-lib}
)